import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
`;

const globalForDb = globalThis as unknown as { __rankingDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!globalForDb.__rankingDb) {
    const file = resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "data/ranking.db");
    mkdirSync(dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec(SCHEMA);
    globalForDb.__rankingDb = conn;
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
