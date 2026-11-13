import "server-only";
import { analyzeMany } from "../analyze";
import { rateLimitSnapshot } from "../github/client";
import { addTeamMembers, createTeam, deleteTeam, getSummaries, getTeam, setTeamAbsent, updateTeam } from "../store";
import { scoreTeam } from "../teamscore";
import type { AbsentMember } from "../types";
import { claimNext, deferRunning, earliestResume, finishTeam, requeueInterrupted, settleJobs, type ImportJob, type ImportTeam } from "./jobs";

/**
 * Ranks imported teams one at a time in the background. Each finished team is written to the
 * database immediately, so results appear as they complete and a restart loses at most the team in
 * progress. When GitHub's hourly limit runs out the queue waits for the reset and carries on.
 */

const state = globalThis as unknown as { __importWorker?: { running: boolean; timer: NodeJS.Timeout | null } };
state.__importWorker ??= { running: false, timer: null };
const worker = state.__importWorker;

export function kickWorker() {
  if (worker.timer) {
    clearTimeout(worker.timer);
    worker.timer = null;
  }
  if (worker.running) return;
  worker.running = true;
  void loop()
    .catch((err) => console.error("[imports] worker stopped:", err))
    .finally(() => {
      worker.running = false;
      scheduleWake();
    });
}

export function resumeOnBoot() {
  requeueInterrupted();
  kickWorker();
}

function scheduleWake() {
  const at = earliestResume();
  if (at === null || worker.timer) return;
  worker.timer = setTimeout(() => {
    worker.timer = null;
    kickWorker();
  }, Math.max(1000, at - Date.now() + 1000));
}

/** Two teams at a time: enough to keep GitHub busy while the request gate holds concurrency down. */
const LANES = 3;

async function loop() {
  const lane = async () => {
    for (;;) {
      const next = claimNext();
      if (!next) return;
      await processTeam(next, next.job);
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  settleJobs();
}

async function processTeam(team: ImportTeam, job: ImportJob) {
  const logins: string[] = [];
  for (const m of team.members) if (m.github && !logins.some((l) => l.toLowerCase() === m.github!.toLowerCase())) logins.push(m.github);
  if (!logins.length) {
    finishTeam(job.id, team.idx, { status: "failed", error: "No GitHub accounts listed for this team." });
    return;
  }

  const { results } = await analyzeMany(logins);

  const blocking = results.find((r) => !r.ok && (r.kind === "rate_limited" || r.kind === "auth"));
  if (blocking) {
    // Put the team back and wait: for the rate-limit reset, or a minute when no token works.
    finishTeam(job.id, team.idx, { status: "pending" });
    const reset = rateLimitSnapshot()?.resetAt ? Date.parse(rateLimitSnapshot()!.resetAt) : 0;
    const until = blocking.kind === "rate_limited" && reset > Date.now() ? reset + 5_000 : Date.now() + 60_000;
    const when = new Date(until).toISOString().slice(11, 16);
    deferRunning(
      until,
      blocking.kind === "rate_limited"
        ? `Waiting for GitHub's hourly limit to reset (about ${when} UTC).`
        : blocking.kind === "auth"
          ? "No working GitHub token. Set GITHUB_TOKEN or sign in with `gh auth login`; retrying every minute."
          : `GitHub isn't responding; retrying at ${when} UTC.`,
    );
    return;
  }

  // A transient GitHub failure is not the team's fault: mark it failed so "Retry failed" can redo it.
  const transient = results.filter((r) => !r.ok && r.kind !== "not_found" && r.kind !== "invalid");
  if (transient.length) {
    finishTeam(job.id, team.idx, {
      status: "failed",
      error: `GitHub error while analysing ${transient.map((r) => `@${r.input}`).join(", ")}: ${transient[0]!.message} Use “Retry failed”.`,
      warnings: team.warnings,
    });
    return;
  }

  const ok = results.filter((r) => r.ok && r.login).map((r) => r.login!);
  if (!ok.length) {
    finishTeam(job.id, team.idx, {
      status: "failed",
      error: results.map((r) => `@${r.input}: ${r.message}`).join(" ") || "No member could be analysed.",
      warnings: team.warnings,
    });
    return;
  }

  // Members with no GitHub listed, or one that doesn't exist.
  const missing: AbsentMember[] = [];
  team.members.forEach((m) => {
    if (!m.github) missing.push({ label: `~${m.name ?? m.email ?? `member ${missing.length + 1}`}`, name: m.name, github: null, reason: "No GitHub account given" });
    else if (!ok.some((l) => l.toLowerCase() === m.github!.toLowerCase())) {
      const r = results.find((x) => x.input.toLowerCase() === m.github!.toLowerCase());
      missing.push({ label: m.github, name: m.name, github: m.github, reason: r?.message ?? "Couldn't be analysed" });
    }
  });
  const countZero = job.missingPolicy === "zero";

  if (team.teamId) deleteTeam(team.teamId); // a retry replaces the earlier result
  const leadMember = team.leader !== null ? team.members[team.leader] : null;
  const leadOk = leadMember?.github ? ok.find((l) => l.toLowerCase() === leadMember.github!.toLowerCase()) ?? null : null;
  const leadAbsent = leadMember && !leadOk && countZero ? missing.find((a) => a.github === leadMember.github && a.name === leadMember.name) ?? null : null;
  const teamId = createTeam(team.name, "leader", job.id);
  addTeamMembers(teamId, ok);
  if (countZero) setTeamAbsent(teamId, missing);
  const leader = leadOk ?? leadAbsent?.label ?? null;
  if (leader) updateTeam(teamId, { leader });

  const result = scoreTeam(getTeam(teamId)!, getSummaries(ok));
  const warnings = [...team.warnings.filter((w) => !w.startsWith("No GitHub found"))];
  for (const a of missing)
    warnings.push(`${a.name ?? a.github}: ${a.reason}${countZero ? " (counts as 0)" : " (left out)"}`);
  if (leadMember && !leadOk && !countZero) warnings.push("The lead couldn't be analysed, so members are weighted equally.");
  finishTeam(job.id, team.idx, { status: "done", teamId, score: result?.total ?? 0, band: result?.band ?? null, warnings });
}
