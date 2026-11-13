import "server-only";
import { randomBytes } from "node:crypto";
import { db, transaction } from "./db";
import type { Assessment, ProfileEvidence, StoredProfile, Team, WeightingMode } from "./types";

interface ProfileRow {
  login: string;
  evidence: string;
  assessment: string;
  analyzed_at: number;
}

const toProfile = (row: ProfileRow): StoredProfile => ({
  login: row.login,
  evidence: JSON.parse(row.evidence) as ProfileEvidence,
  assessment: JSON.parse(row.assessment) as Assessment,
  analyzedAt: row.analyzed_at,
});

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

export function saveProfile(evidence: ProfileEvidence, assessment: Assessment, analyzedAt = Date.now()) {
  db()
    .prepare(
      `INSERT INTO profiles (login, evidence, assessment, total, methodology, analyzed_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET login = excluded.login, evidence = excluded.evidence, assessment = excluded.assessment,
         total = excluded.total, methodology = excluded.methodology, analyzed_at = excluded.analyzed_at`,
    )
    .run(evidence.login, JSON.stringify(evidence), JSON.stringify(assessment), assessment.total, assessment.methodology, analyzedAt);
}

/* ------------------------------------------------------------- individuals ------------------------------------------------------------- */

export interface StandingRow {
  login: string;
  addedAt: number;
  profile: StoredProfile;
}

export function listIndividuals(): StandingRow[] {
  const rows = db()
    .prepare(
      `SELECT p.login, p.evidence, p.assessment, p.analyzed_at, i.added_at
         FROM individuals i JOIN profiles p ON p.login = i.login
        ORDER BY p.total DESC, p.login ASC`,
    )
    .all() as unknown as (ProfileRow & { added_at: number })[];
  return rows.map((r) => ({ login: r.login, addedAt: r.added_at, profile: toProfile(r) }));
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
}

function hydrate(rows: TeamRow[]): Team[] {
  if (!rows.length) return [];
  const members = db()
    .prepare(`SELECT team_id, login, added_at FROM team_members WHERE team_id IN (${rows.map(() => "?").join(",")}) ORDER BY added_at, rowid`)
    .all(...rows.map((r) => r.id)) as unknown as { team_id: string; login: string; added_at: number }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    leader: r.leader,
    createdAt: r.created_at,
    members: members.filter((m) => m.team_id === r.id).map((m) => ({ login: m.login, addedAt: m.added_at })),
  }));
}

export function listTeams(): Team[] {
  return hydrate(db().prepare("SELECT * FROM teams ORDER BY created_at").all() as unknown as TeamRow[]);
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

export function findTeamByName(name: string): Team | null {
  const row = db().prepare("SELECT * FROM teams WHERE name = ? COLLATE NOCASE").get(name) as TeamRow | undefined;
  return row ? hydrate([row])[0]! : null;
}

export function createTeam(name: string, mode: WeightingMode): string {
  const id = slug(name);
  db().prepare("INSERT INTO teams (id, name, mode, leader, created_at) VALUES (?, ?, ?, NULL, ?)").run(id, name, mode, Date.now());
  return id;
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

export function deleteTeam(id: string) {
  db().prepare("DELETE FROM teams WHERE id = ?").run(id);
}
