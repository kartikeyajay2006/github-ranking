import "server-only";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Database protection:
 * - consistent snapshots with `VACUUM INTO` (safe while the app is writing), every hour when the data
 *   changed, at start-up, and before anything destructive;
 * - every snapshot is integrity-checked before it is kept;
 * - rotation keeps the last 24 snapshots plus one per day for 14 days (BACKUP_KEEP, BACKUP_KEEP_DAYS);
 * - an optional BACKUP_COMMAND copies each snapshot off the machine (e.g. `aws s3 cp "$1" s3://…/`);
 * - on start-up a corrupt database is moved aside and the newest healthy snapshot restored.
 */

export const databaseFile = () => resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH || "data/ranking.db");
export const backupDir = () => resolve(/*turbopackIgnore: true*/ process.env.BACKUP_DIR || join(dirname(databaseFile()), "backups"));

const KEEP_RECENT = Math.max(1, Number(process.env.BACKUP_KEEP ?? 24));
const KEEP_DAILY_DAYS = Math.max(0, Number(process.env.BACKUP_KEEP_DAYS ?? 14));
const PREFIX = "ranking-";

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");

function healthy(file: string): boolean {
  try {
    const conn = new DatabaseSync(file, { readOnly: true });
    const row = conn.prepare("PRAGMA quick_check").get() as Record<string, string>;
    conn.close();
    return Object.values(row)[0] === "ok";
  } catch {
    return false;
  }
}

export function listBackups(): { file: string; at: number; bytes: number }[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db"))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { file: join(dir, f), at: st.mtimeMs, bytes: st.size };
    })
    .sort((a, b) => b.at - a.at);
}

function rotate() {
  const all = listBackups();
  const keep = new Set(all.slice(0, KEEP_RECENT).map((b) => b.file));
  const days = new Set<string>();
  for (const b of all) {
    const day = new Date(b.at).toISOString().slice(0, 10);
    if (Date.now() - b.at < KEEP_DAILY_DAYS * 86_400_000 && !days.has(day)) {
      days.add(day);
      keep.add(b.file);
    }
  }
  for (const b of all) if (!keep.has(b.file)) unlinkSync(b.file);
}

function offsite(file: string) {
  const cmd = process.env.BACKUP_COMMAND;
  if (!cmd) return;
  execFile("/bin/sh", ["-c", cmd, "backup", file], { timeout: 300_000 }, (err, _out, stderr) => {
    if (err) console.error(`[backup] BACKUP_COMMAND failed for ${basename(file)}:`, stderr || err.message);
  });
}

let lastBackupAt = 0;

/** Takes a verified snapshot of the live database. Returns its path, or null when skipped or failed. */
export function backupNow(conn: DatabaseSync, reason: string, { minIntervalMs = 0 } = {}): string | null {
  if (Date.now() - lastBackupAt < minIntervalMs) return null;
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${PREFIX}${stamp()}-${reason.replace(/[^a-z0-9-]/gi, "")}.db`);
  try {
    conn.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } catch (err) {
    console.error("[backup] snapshot failed:", (err as Error).message);
    return null;
  }
  if (!healthy(file)) {
    console.error(`[backup] snapshot ${basename(file)} failed its integrity check and was discarded.`);
    unlinkSync(file);
    return null;
  }
  lastBackupAt = Date.now();
  rotate();
  offsite(file);
  return file;
}

/** Has the database file changed since the newest snapshot? */
function changedSinceLastBackup(): boolean {
  const newest = listBackups()[0];
  if (!newest) return true;
  const db = databaseFile();
  const mtimes = [db, `${db}-wal`].filter(existsSync).map((f) => statSync(f).mtimeMs);
  return Math.max(0, ...mtimes) > newest.at;
}

/**
 * Before the database is opened: if it exists but fails its integrity check, move it aside and restore
 * the newest healthy snapshot. Returns a description of what happened, for the log.
 */
export function recoverIfCorrupt(): string | null {
  const db = databaseFile();
  if (!existsSync(db) || healthy(db)) return null;
  const aside = `${db}.corrupt-${stamp()}`;
  renameSync(db, aside);
  for (const suffix of ["-wal", "-shm"]) if (existsSync(db + suffix)) renameSync(db + suffix, aside + suffix);
  const good = listBackups().find((b) => healthy(b.file));
  if (!good) return `Database failed its integrity check; moved to ${basename(aside)}. No healthy snapshot was found, so a new database was started.`;
  const conn = new DatabaseSync(good.file, { readOnly: true });
  conn.exec(`VACUUM INTO '${db.replace(/'/g, "''")}'`);
  conn.close();
  return `Database failed its integrity check; moved to ${basename(aside)} and restored from ${basename(good.file)}.`;
}

const state = globalThis as unknown as { __backupTimer?: NodeJS.Timeout };

/** Hourly snapshots while anything changed, plus one at start-up. */
export function scheduleBackups(conn: DatabaseSync) {
  if (state.__backupTimer || process.env.BACKUP_DISABLED === "1") return;
  if (changedSinceLastBackup()) backupNow(conn, "startup");
  const hours = Math.max(0.25, Number(process.env.BACKUP_INTERVAL_HOURS ?? 1));
  state.__backupTimer = setInterval(() => {
    if (changedSinceLastBackup()) backupNow(conn, "hourly");
  }, hours * 3_600_000);
  state.__backupTimer.unref();
}
