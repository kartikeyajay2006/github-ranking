import "server-only";
import { analyzeMany } from "../analyze";
import { GitHubError, rateLimitSnapshot } from "../github/client";
import { analyzeProject, type ProjectResult } from "../project";
import { type MemberBreakdown, teamScore } from "../scoring/project";
import { addTeamMembers, createTeam, deleteTeam, getSummaries, getTeam, setTeamAbsent, updateTeam } from "../store";
import { scoreTeam } from "../teamscore";
import type { AbsentMember } from "../types";
import { claimNext, deferRunning, earliestResume, finishTeam, hasRunningJob, requeueGlitched, requeueInterrupted, requeueLater, settleJobs, type ImportJob, type ImportTeam } from "./jobs";

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
  requeueGlitched();
  kickWorker();
  keepAwakeWhileRanking();
}

/**
 * Free hosts (Render's free plan) put a service to sleep after 15 minutes without inbound requests, and
 * background work doesn't count. While an import is running, the server requests its own public address
 * every 10 minutes so ranking carries on with nobody watching; when idle it is allowed to sleep.
 */
function keepAwakeWhileRanking() {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  const flag = globalThis as unknown as { __keepAwake?: NodeJS.Timeout };
  if (!url || flag.__keepAwake) return;
  flag.__keepAwake = setInterval(() => {
    if (!hasRunningJob()) return;
    fetch(`${url.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(30_000) }).catch(() => {});
  }, 10 * 60_000);
  flag.__keepAwake.unref();
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
      try {
        await processTeam(next, next.job);
      } catch (err) {
        // An unexpected error on one team must never stop the queue or strand the team.
        console.error("[imports] team failed unexpectedly:", err);
        if (!requeueLater(next.job.id, next.idx, `Unexpected error: ${(err as Error).message}. Trying again shortly.`))
          finishTeam(next.job.id, next.idx, { status: "failed", error: `GitHub error while analysing this team: ${(err as Error).message}`, warnings: next.warnings });
      }
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  settleJobs();
}

async function processTeam(team: ImportTeam, job: ImportJob) {
  const logins: string[] = [];
  for (const m of team.members) if (m.github && !logins.some((l) => l.toLowerCase() === m.github!.toLowerCase())) logins.push(m.github);
  const countZero = job.missingPolicy === "zero";
  // With "count as 0", a team where nobody has a usable GitHub is still ranked, at 0, rather than dropped.
  if (!logins.length && !countZero) {
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
    const why = `GitHub error while analysing ${transient.map((r) => `@${r.input}`).join(", ")}: ${transient[0]!.message}`;
    // A glitch is not the team's fault: it waits a little longer each time (1, 2, 4, 8, 15 min) while the
    // rest of the import carries on, and only fails after several tries.
    if (requeueLater(job.id, team.idx, `${why} Trying again shortly.`)) return;
    finishTeam(job.id, team.idx, { status: "failed", error: `${why} It was tried ${6} times; use “Retry failed”.`, warnings: team.warnings });
    return;
  }

  const ok = results.filter((r) => r.ok && r.login).map((r) => r.login!);
  if (!ok.length && !countZero) {
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
  if (!ok.length) warnings.push("No member has a usable GitHub account, so the team scores 0.");

  // Best projects: each analysed member's own repository, graded on its own evidence.
  const projects = new Map<string, ProjectResult>();
  try {
    await Promise.all(
      ok.map(async (login) => {
        const member = team.members.find((m) => m.github?.toLowerCase() === login.toLowerCase());
        try {
          projects.set(login.toLowerCase(), await analyzeProject(login, member?.project));
        } catch (err) {
          if (err instanceof GitHubError && (err.kind === "rate_limited" || err.kind === "auth")) throw err;
          projects.set(login.toLowerCase(), { ok: false, link: member?.project ?? null, reason: `Best project couldn't be analysed (${(err as Error).message})` });
        }
      }),
    );
  } catch (err) {
    // Out of GitHub quota mid-team: put the team back and wait, as for profiles.
    deleteTeam(teamId);
    finishTeam(job.id, team.idx, { status: "pending" });
    const reset = rateLimitSnapshot()?.resetAt ? Date.parse(rateLimitSnapshot()!.resetAt) : 0;
    const until = reset > Date.now() ? reset + 5_000 : Date.now() + 60_000;
    deferRunning(until, `Waiting for GitHub's hourly limit to reset (about ${new Date(until).toISOString().slice(11, 16)} UTC).`);
    void err;
    return;
  }

  const breakdown: MemberBreakdown[] = (result?.members ?? []).map((r) => {
    const login = ok.find((l) => l.toLowerCase() === r.login.toLowerCase()) ?? null;
    const source = login
      ? team.members.find((m) => m.github?.toLowerCase() === login.toLowerCase())
      : team.members.find((m) => missing.some((a) => a.label === r.login && a.name === m.name && a.github === m.github));
    const p = login ? projects.get(login.toLowerCase()) : undefined;
    return {
      label: r.login,
      login,
      name: source?.name ?? null,
      weight: r.weight,
      isLeader: r.isLeader,
      github: r.score,
      project: p?.ok ? p.assessment.score : null,
      projectRepo: p?.ok ? p.assessment.repo : null,
      projectLink: source?.project ?? null,
      projectNote: p ? (p.ok ? null : p.reason) : login ? null : "No usable GitHub account",
    };
  });
  const scored = teamScore(breakdown, job.projectWeight, job.projectMissing);
  finishTeam(job.id, team.idx, {
    status: "done",
    teamId,
    score: scored.total,
    band: scored.band,
    warnings,
    breakdown,
    githubScore: scored.github,
    projectScore: scored.project,
  });
}
