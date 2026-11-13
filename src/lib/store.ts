import "server-only";
import { randomBytes } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { db, transaction } from "./db";
import type { AbsentMember, Assessment, ProfileEvidence, ProfileSummary, StoredProfile, Team, WeightingMode } from "./types";

interface ProfileRow {
  login: string;
  evidence: string | Uint8Array;
  assessment: string | Uint8Array;
  analyzed_at: number;
}

/**
 * Evidence and assessments are stored Brotli-compressed (about 7× smaller), which keeps a database of
 * tens of thousands of people, and its snapshots, compact. Rows written as plain JSON still read fine.
 */
const pack = (value: unknown) => brotliCompressSync(Buffer.from(JSON.stringify(value)), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
function unpack<T>(stored: string | Uint8Array): T {
  return JSON.parse(typeof stored === "string" ? stored : brotliDecompressSync(stored).toString("utf8")) as T;
}

const toProfile = (row: ProfileRow): StoredProfile => ({
  login: row.login,
  evidence: unpack<ProfileEvidence>(row.evidence),
  assessment: unpack<Assessment>(row.assessment),
  analyzedAt: row.analyzed_at,
});

/** Rows changed through this connection since it opened: any write moves it, so it keys in-memory caches. */
export const dataVersion = () => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;

/* -------------------------------------------------------------- profiles -------------------------------------------------------------- */

export function getProfile(login: string): StoredProfile | null {
  const row = db().prepare("SELECT login, evidence, assessment, analyzed_at FROM profiles WHERE login = ?").get(login) as
    | ProfileRow
    | undefined;
  return row ? toProfile(row) : null;
}

export function getProfiles(logins: string[]): Map<string, StoredProfile> {
  const out = new Map<string, StoredProfile>();
  if (!logins.length) return out;
  const rows = db()
    .prepare(`SELECT login, evidence, assessment, analyzed_at FROM profiles WHERE login IN (${logins.map(() => "?").join(",")})`)
    .all(...logins) as unknown as ProfileRow[];
  for (const row of rows) out.set(row.login.toLowerCase(), toProfile(row));
  return out;
}

export function summarise(evidence: Pick<ProfileEvidence, "login" | "name" | "avatarUrl">, assessment: Assessment, analyzedAt: number): ProfileSummary {
  return {
    login: evidence.login,
    name: evidence.name,
    avatarUrl: evidence.avatarUrl,
    total: assessment.total,
    band: assessment.band,
    methodology: assessment.methodology,
    analyzedAt,
    dimensions: assessment.dimensions.map((d) => ({ key: d.key, label: d.label, weight: d.weight, score: d.score })),
    split: assessment.split,
  };
}

export function saveProfile(evidence: ProfileEvidence, assessment: Assessment, analyzedAt = Date.now()) {
  db()
    .prepare(
      `INSERT INTO profiles (login, evidence, assessment, total, methodology, analyzed_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET login = excluded.login, evidence = excluded.evidence, assessment = excluded.assessment,
         total = excluded.total, methodology = excluded.methodology, analyzed_at = excluded.analyzed_at, summary = excluded.summary`,
    )
    .run(
      evidence.login,
      pack(evidence),
      pack(assessment),
      assessment.total,
      assessment.methodology,
      analyzedAt,
      JSON.stringify(summarise(evidence, assessment, analyzedAt)),
    );
}

let summariesChecked = false;
/** One-time backfill for profiles stored before summaries existed. */
function ensureSummaries() {
  if (summariesChecked) return;
  const missing = db().prepare("SELECT login, evidence, assessment, analyzed_at FROM profiles WHERE summary IS NULL").all() as unknown as ProfileRow[];
  const update = db().prepare("UPDATE profiles SET summary = ? WHERE login = ?");
  for (const row of missing) {
    const p = toProfile(row);
    update.run(JSON.stringify(summarise(p.evidence, p.assessment, p.analyzedAt)), row.login);
  }
  summariesChecked = true;
}

export function getSummaries(logins: string[]): Map<string, ProfileSummary> {
  ensureSummaries();
  const out = new Map<string, ProfileSummary>();
  for (let i = 0; i < logins.length; i += 500) {
    const part = logins.slice(i, i + 500);
    const rows = db()
      .prepare(`SELECT summary FROM profiles WHERE login IN (${part.map(() => "?").join(",")})`)
      .all(...part) as { summary: string }[];
    for (const r of rows) {
      const s = JSON.parse(r.summary) as ProfileSummary;
      out.set(s.login.toLowerCase(), s);
    }
  }
  return out;
}

/* ------------------------------------------------------------- individuals ------------------------------------------------------------- */

export interface StandingRow {
  login: string;
  addedAt: number;
  summary: ProfileSummary;
}

export function listIndividuals(): StandingRow[] {
  ensureSummaries();
  const rows = db()
    .prepare(
      `SELECT p.login, p.summary, i.added_at
         FROM individuals i JOIN profiles p ON p.login = i.login
        ORDER BY p.total DESC, p.login ASC`,
    )
    .all() as unknown as { login: string; summary: string; added_at: number }[];
  return rows.map((r) => ({ login: r.login, addedAt: r.added_at, summary: JSON.parse(r.summary) as ProfileSummary }));
}

export function isIndividual(login: string): boolean {
  return !!db().prepare("SELECT 1 FROM individuals WHERE login = ?").get(login);
}

export function addIndividual(login: string) {
  db().prepare("INSERT OR IGNORE INTO individuals (login, added_at) VALUES (?, ?)").run(login, Date.now());
}

export function removeIndividual(login: string) {
  db().prepare("DELETE FROM individuals WHERE login = ?").run(login);
}

/* ---------------------------------------------------------------- teams ---------------------------------------------------------------- */

interface TeamRow {
  id: string;
  name: string;
  mode: WeightingMode;
  leader: string | null;
  created_at: number;
  job_id: string | null;
  absent: string | null;
}

function hydrate(rows: TeamRow[], all = false): Team[] {
  if (!rows.length) return [];
  type M = { team_id: string; login: string; added_at: number };
  // For the full list, one scan of team_members beats thousands of placeholders.
  const members = (
    all
      ? db().prepare("SELECT team_id, login, added_at FROM team_members ORDER BY added_at, rowid").all()
      : db()
          .prepare(`SELECT team_id, login, added_at FROM team_members WHERE team_id IN (${rows.map(() => "?").join(",")}) ORDER BY added_at, rowid`)
          .all(...rows.map((r) => r.id))
  ) as unknown as M[];
  const byTeam = new Map<string, M[]>();
  for (const m of members) {
    const list = byTeam.get(m.team_id);
    if (list) list.push(m);
    else byTeam.set(m.team_id, [m]);
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    leader: r.leader,
    createdAt: r.created_at,
    jobId: r.job_id,
    absent: r.absent ? (JSON.parse(r.absent) as AbsentMember[]) : [],
    members: (byTeam.get(r.id) ?? []).map((m) => ({ login: m.login, addedAt: m.added_at })),
  }));
}

export function listTeams(): Team[] {
  return hydrate(db().prepare("SELECT * FROM teams ORDER BY created_at").all() as unknown as TeamRow[], true);
}

export function getTeam(id: string): Team | null {
  return hydrate(db().prepare("SELECT * FROM teams WHERE id = ?").all(id) as unknown as TeamRow[])[0] ?? null;
}

export function teamsForLogin(login: string): { id: string; name: string }[] {
  return db()
    .prepare("SELECT t.id, t.name FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.login = ? ORDER BY t.name")
    .all(login) as unknown as { id: string; name: string }[];
}

function slug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 40);
  return `${base || "team"}-${randomBytes(3).toString("hex")}`;
}

/** Manually created teams only: imported teams are managed by their import. */
export function findTeamByName(name: string): Team | null {
  const row = db().prepare("SELECT * FROM teams WHERE name = ? COLLATE NOCASE AND job_id IS NULL").get(name) as TeamRow | undefined;
  return row ? hydrate([row])[0]! : null;
}

export function createTeam(name: string, mode: WeightingMode, jobId: string | null = null): string {
  const id = slug(name);
  db().prepare("INSERT INTO teams (id, name, mode, leader, created_at, job_id) VALUES (?, ?, ?, NULL, ?, ?)").run(id, name, mode, Date.now(), jobId);
  return id;
}

export function jobNames(): Map<string, string> {
  return new Map((db().prepare("SELECT id, name FROM import_jobs").all() as { id: string; name: string }[]).map((r) => [r.id, r.name]));
}

export function addTeamMembers(teamId: string, logins: string[]) {
  transaction(() => {
    const stmt = db().prepare("INSERT OR IGNORE INTO team_members (team_id, login, added_at) VALUES (?, ?, ?)");
    const now = Date.now();
    for (const login of logins) stmt.run(teamId, login, now);
  });
}

export function removeTeamMember(teamId: string, login: string) {
  transaction(() => {
    db().prepare("DELETE FROM team_members WHERE team_id = ? AND login = ?").run(teamId, login);
    db().prepare("UPDATE teams SET leader = NULL WHERE id = ? AND leader = ?").run(teamId, login);
  });
}

export function updateTeam(id: string, patch: { name?: string; mode?: WeightingMode; leader?: string | null }) {
  if (patch.name !== undefined) db().prepare("UPDATE teams SET name = ? WHERE id = ?").run(patch.name, id);
  if (patch.mode !== undefined) db().prepare("UPDATE teams SET mode = ? WHERE id = ?").run(patch.mode, id);
  if (patch.leader !== undefined) db().prepare("UPDATE teams SET leader = ? WHERE id = ?").run(patch.leader, id);
}

export function setTeamAbsent(id: string, absent: AbsentMember[]) {
  db().prepare("UPDATE teams SET absent = ? WHERE id = ?").run(absent.length ? JSON.stringify(absent) : null, id);
}

export function deleteTeam(id: string) {
  db().prepare("DELETE FROM teams WHERE id = ?").run(id);
}
