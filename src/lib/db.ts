import "server-only";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupNow, databaseFile, recoverIfCorrupt, scheduleBackups } from "./backup";

const SCHEMA = /* SQL */ `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- One row per GitHub account ever analysed. Each row is computed from that account alone.
  CREATE TABLE IF NOT EXISTS profiles (
    login        TEXT PRIMARY KEY COLLATE NOCASE,
    evidence     TEXT NOT NULL,
    assessment   TEXT NOT NULL,
    total        REAL NOT NULL,
    methodology  TEXT NOT NULL,
    analyzed_at  INTEGER NOT NULL
  );

  -- Accounts entered in the individual standings.
  CREATE TABLE IF NOT EXISTS individuals (
    login     TEXT PRIMARY KEY COLLATE NOCASE REFERENCES profiles(login) ON DELETE CASCADE,
    added_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    mode        TEXT NOT NULL CHECK (mode IN ('leader', 'equal')) DEFAULT 'leader',
    leader      TEXT COLLATE NOCASE,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    login     TEXT NOT NULL COLLATE NOCASE,
    added_at  INTEGER NOT NULL,
    PRIMARY KEY (team_id, login)
  );

  CREATE INDEX IF NOT EXISTS team_members_login ON team_members(login);

  -- Bulk imports: one job per uploaded document, one row per team found in it.
  CREATE TABLE IF NOT EXISTS import_jobs (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    source         TEXT NOT NULL,
    method         TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('draft', 'running', 'paused', 'done')),
    leader_policy  TEXT NOT NULL DEFAULT 'first' CHECK (leader_policy IN ('first', 'equal')),
    cutoff         INTEGER,
    note           TEXT,
    resume_at      INTEGER,
    created_at     INTEGER NOT NULL,
    started_at     INTEGER,
    finished_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS import_teams (
    job_id       TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    name         TEXT NOT NULL,
    members      TEXT NOT NULL,
    warnings     TEXT NOT NULL DEFAULT '[]',
    leader       INTEGER,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
    team_id      TEXT,
    score        REAL,
    band         TEXT,
    error        TEXT,
    finished_at  INTEGER,
    PRIMARY KEY (job_id, idx)
  );

  CREATE INDEX IF NOT EXISTS import_teams_status ON import_teams(job_id, status);
`;

/** Additive migrations for databases created by earlier versions. */
function migrate(conn: DatabaseSync) {
  const columns = (table: string) => (conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const pending =
    !columns("teams").includes("job_id") ||
    !columns("profiles").includes("summary") ||
    !columns("teams").includes("absent") ||
    !columns("import_jobs").includes("missing_policy");
  if (pending && (conn.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number }).n > 0) backupNow(conn, "pre-migration");
  if (!columns("teams").includes("job_id")) conn.exec("ALTER TABLE teams ADD COLUMN job_id TEXT");
  if (!columns("profiles").includes("summary")) conn.exec("ALTER TABLE profiles ADD COLUMN summary TEXT");
  if (!columns("teams").includes("absent")) conn.exec("ALTER TABLE teams ADD COLUMN absent TEXT");
  if (!columns("import_jobs").includes("missing_policy")) conn.exec("ALTER TABLE import_jobs ADD COLUMN missing_policy TEXT NOT NULL DEFAULT 'zero'");
  conn.exec("CREATE INDEX IF NOT EXISTS teams_job ON teams(job_id)");
}

const globalForDb = globalThis as unknown as { __rankingDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!globalForDb.__rankingDb) {
    const file = databaseFile();
    mkdirSync(dirname(file), { recursive: true });
    const recovered = recoverIfCorrupt();
    if (recovered) console.error(`[db] ${recovered}`);
    const conn = new DatabaseSync(file);
    // FULL: a committed write survives power loss, not just a crash. busy_timeout: CLI tools may hold a lock briefly.
    conn.exec("PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    conn.exec(SCHEMA);
    migrate(conn);
    globalForDb.__rankingDb = conn;
    scheduleBackups(conn);
    // Fold the write-ahead log into the main file on shutdown, so the .db file alone is a complete copy.
    process.once("exit", () => {
      try {
        conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        conn.close();
      } catch {
        /* already closed */
      }
    });
  }
  return globalForDb.__rankingDb;
}

export function transaction<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
