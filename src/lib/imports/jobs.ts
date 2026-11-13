import "server-only";
import { randomBytes } from "node:crypto";
import { backupNow } from "../backup";
import { db, transaction } from "../db";
import { type ExtractedMember, type ExtractedTeam, leaderOf } from "./extract";

export type JobStatus = "draft" | "running" | "paused" | "done";
export type LeaderPolicy = "first" | "equal";
/** What happens to members whose GitHub account is missing or doesn't exist. */
export type MissingPolicy = "zero" | "skip";

export interface ImportJob {
  id: string;
  name: string;
  source: string;
  method: string;
  status: JobStatus;
  leaderPolicy: LeaderPolicy;
  missingPolicy: MissingPolicy;
  cutoff: number | null;
  note: string | null;
  resumeAt: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ImportTeam {
  jobId: string;
  idx: number;
  name: string;
  members: ExtractedMember[];
  warnings: string[];
  leader: number | null;
  status: "pending" | "running" | "done" | "failed";
  teamId: string | null;
  score: number | null;
  band: string | null;
  error: string | null;
  finishedAt: number | null;
}

export interface JobCounts {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  people: number;
}

interface JobRow {
  id: string;
  name: string;
  source: string;
  method: string;
  status: JobStatus;
  leader_policy: LeaderPolicy;
  missing_policy: MissingPolicy;
  cutoff: number | null;
  note: string | null;
  resume_at: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

interface TeamRowDb {
  job_id: string;
  idx: number;
  name: string;
  members: string;
  warnings: string;
  leader: number | null;
  status: ImportTeam["status"];
  team_id: string | null;
  score: number | null;
  band: string | null;
  error: string | null;
  finished_at: number | null;
}

const toJob = (r: JobRow): ImportJob => ({
  id: r.id,
  name: r.name,
  source: r.source,
  method: r.method,
  status: r.status,
  leaderPolicy: r.leader_policy,
  missingPolicy: r.missing_policy ?? "zero",
  cutoff: r.cutoff,
  note: r.note,
  resumeAt: r.resume_at,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

const toTeam = (r: TeamRowDb): ImportTeam => ({
  jobId: r.job_id,
  idx: r.idx,
  name: r.name,
  members: JSON.parse(r.members) as ExtractedMember[],
  warnings: JSON.parse(r.warnings) as string[],
  leader: r.leader,
  status: r.status,
  teamId: r.team_id,
  score: r.score,
  band: r.band,
  error: r.error,
  finishedAt: r.finished_at,
});

export function createJob(name: string, source: string, method: string, teams: ExtractedTeam[]): string {
  const id = `imp-${randomBytes(5).toString("hex")}`;
  transaction(() => {
    db()
      .prepare("INSERT INTO import_jobs (id, name, source, method, status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)")
      .run(id, name, source, method, Date.now());
    const insert = db().prepare("INSERT INTO import_teams (job_id, idx, name, members, warnings) VALUES (?, ?, ?, ?, ?)");
    teams.forEach((t, i) => insert.run(id, i, t.name, JSON.stringify(t.members), JSON.stringify(t.warnings)));
  });
  return id;
}

export function getJob(id: string): ImportJob | null {
  const row = db().prepare("SELECT * FROM import_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function jobCounts(id: string): JobCounts {
  const rows = db().prepare("SELECT status, COUNT(*) AS n FROM import_teams WHERE job_id = ? GROUP BY status").all(id) as { status: string; n: number }[];
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const members = db().prepare("SELECT members FROM import_teams WHERE job_id = ?").all(id) as { members: string }[];
  const people = new Set<string>();
  for (const m of members) for (const p of JSON.parse(m.members) as ExtractedMember[]) if (p.github) people.add(p.github.toLowerCase());
  return {
    total: rows.reduce((s, r) => s + r.n, 0),
    pending: by.pending ?? 0,
    running: by.running ?? 0,
    done: by.done ?? 0,
    failed: by.failed ?? 0,
    people: people.size,
  };
}

export function listJobs(): (ImportJob & { counts: JobCounts })[] {
  return (db().prepare("SELECT * FROM import_jobs ORDER BY created_at DESC").all() as unknown as JobRow[]).map((r) => ({
    ...toJob(r),
    counts: jobCounts(r.id),
  }));
}

export function jobTeams(id: string, status?: ImportTeam["status"]): ImportTeam[] {
  const rows = status
    ? db().prepare("SELECT * FROM import_teams WHERE job_id = ? AND status = ? ORDER BY idx").all(id, status)
    : db().prepare("SELECT * FROM import_teams WHERE job_id = ? ORDER BY idx").all(id);
  return (rows as unknown as TeamRowDb[]).map(toTeam);
}

/** Completed teams, best first. */
export function rankedTeams(id: string): ImportTeam[] {
  return (
    db().prepare("SELECT * FROM import_teams WHERE job_id = ? AND status = 'done' ORDER BY score DESC, idx ASC").all(id) as unknown as TeamRowDb[]
  ).map(toTeam);
}

export function startJob(id: string, policy: LeaderPolicy, cutoff: number | null, missing: MissingPolicy = "zero") {
  transaction(() => {
    const teams = jobTeams(id);
    const setLeader = db().prepare("UPDATE import_teams SET leader = ? WHERE job_id = ? AND idx = ?");
    for (const t of teams) setLeader.run(leaderOf(t, policy), id, t.idx);
    db()
      .prepare(
        "UPDATE import_jobs SET status = 'running', leader_policy = ?, missing_policy = ?, cutoff = ?, started_at = COALESCE(started_at, ?), note = NULL WHERE id = ?",
      )
      .run(policy, missing, cutoff, Date.now(), id);
  });
}

export function setJobStatus(id: string, status: JobStatus, note: string | null = null) {
  db()
    .prepare("UPDATE import_jobs SET status = ?, note = ?, finished_at = CASE WHEN ? = 'done' THEN ? ELSE finished_at END WHERE id = ?")
    .run(status, note, status, Date.now(), id);
}

export function setCutoff(id: string, cutoff: number | null) {
  db().prepare("UPDATE import_jobs SET cutoff = ? WHERE id = ?").run(cutoff, id);
}

/** Pauses every running job until GitHub's limit resets (the token is shared, so they all wait). */
export function deferRunning(until: number, note: string) {
  db().prepare("UPDATE import_jobs SET resume_at = ?, note = ? WHERE status = 'running'").run(until, note);
}

export function retryFailed(id: string) {
  db().prepare("UPDATE import_teams SET status = 'pending', error = NULL WHERE job_id = ? AND status = 'failed'").run(id);
  db().prepare("UPDATE import_jobs SET status = 'running', finished_at = NULL, note = NULL WHERE id = ?").run(id);
}

export function deleteJob(id: string) {
  // A deleted import takes its teams with it: keep a snapshot first (at most one every five minutes).
  backupNow(db(), "before-delete", { minIntervalMs: 5 * 60_000 });
  transaction(() => {
    db().prepare("DELETE FROM teams WHERE job_id = ?").run(id);
    db().prepare("DELETE FROM import_jobs WHERE id = ?").run(id);
  });
}

/** Claims the next pending team of the oldest running job whose wait (if any) is over. */
export function claimNext(now = Date.now()): (ImportTeam & { job: ImportJob }) | null {
  return transaction(() => {
    const row = db()
      .prepare(
        `SELECT t.* FROM import_teams t JOIN import_jobs j ON j.id = t.job_id
          WHERE j.status = 'running' AND (j.resume_at IS NULL OR j.resume_at <= ?) AND t.status = 'pending'
          ORDER BY j.created_at ASC, t.idx ASC LIMIT 1`,
      )
      .get(now) as TeamRowDb | undefined;
    if (!row) return null;
    db().prepare("UPDATE import_teams SET status = 'running' WHERE job_id = ? AND idx = ?").run(row.job_id, row.idx);
    db().prepare("UPDATE import_jobs SET resume_at = NULL, note = NULL WHERE id = ? AND resume_at IS NOT NULL").run(row.job_id);
    return { ...toTeam(row), status: "running" as const, job: getJob(row.job_id)! };
  });
}

export function finishTeam(
  jobId: string,
  idx: number,
  result: { status: "done" | "failed" | "pending"; teamId?: string | null; score?: number | null; band?: string | null; error?: string | null; warnings?: string[] },
) {
  db()
    .prepare(
      `UPDATE import_teams SET status = ?, team_id = ?, score = ?, band = ?, error = ?, warnings = COALESCE(?, warnings), finished_at = ?
        WHERE job_id = ? AND idx = ?`,
    )
    .run(
      result.status,
      result.teamId ?? null,
      result.score ?? null,
      result.band ?? null,
      result.error ?? null,
      result.warnings ? JSON.stringify(result.warnings) : null,
      result.status === "pending" ? null : Date.now(),
      jobId,
      idx,
    );
}

/** Marks running jobs with nothing left to do as done. */
export function settleJobs() {
  db()
    .prepare(
      `UPDATE import_jobs SET status = 'done', finished_at = ?, note = NULL
        WHERE status = 'running' AND NOT EXISTS (SELECT 1 FROM import_teams t WHERE t.job_id = import_jobs.id AND t.status IN ('pending', 'running'))`,
    )
    .run(Date.now());
}

/** After a restart, teams caught mid-analysis go back in the queue. */
export function requeueInterrupted() {
  db().prepare("UPDATE import_teams SET status = 'pending' WHERE status = 'running'").run();
}

export function earliestResume(): number | null {
  const row = db().prepare("SELECT MIN(resume_at) AS t FROM import_jobs WHERE status = 'running' AND resume_at IS NOT NULL").get() as { t: number | null };
  return row.t;
}
