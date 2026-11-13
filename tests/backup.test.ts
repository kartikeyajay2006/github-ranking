import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = mkdtempSync(join(tmpdir(), "ranking-backup-"));
process.env.DATABASE_PATH = join(dir, "ranking.db");
process.env.BACKUP_DIR = join(dir, "backups");
const backup = await import("@/lib/backup");

const seed = (rows: number) => {
  const c = new DatabaseSync(process.env.DATABASE_PATH!);
  c.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS t (v TEXT)");
  for (let i = 0; i < rows; i++) c.prepare("INSERT INTO t VALUES (?)").run(`row ${i}`);
  return c;
};
const count = (file: string) => {
  const c = new DatabaseSync(file, { readOnly: true });
  const n = (c.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n;
  c.close();
  return n;
};

let conn: DatabaseSync;
beforeAll(() => {
  conn = seed(50);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("backups", () => {
  it("takes a consistent, verified snapshot of a live database (including un-checkpointed WAL writes)", () => {
    const file = backup.backupNow(conn, "test")!;
    expect(file).toBeTruthy();
    expect(count(file)).toBe(50);
    expect(backup.listBackups()[0]!.file).toBe(file);
  });

  it("throttles when asked", () => {
    expect(backup.backupNow(conn, "test", { minIntervalMs: 60_000 })).toBeNull();
  });

  it("leaves a healthy database alone", () => {
    expect(backup.recoverIfCorrupt()).toBeNull();
  });

  it("moves a corrupt database aside and restores the newest healthy snapshot", () => {
    conn.close();
    rmSync(process.env.DATABASE_PATH + "-wal", { force: true });
    rmSync(process.env.DATABASE_PATH + "-shm", { force: true });
    writeFileSync(process.env.DATABASE_PATH!, Buffer.alloc(8192, 7)); // garbage
    const message = backup.recoverIfCorrupt();
    expect(message).toMatch(/restored from ranking-/);
    expect(count(process.env.DATABASE_PATH!)).toBe(50);
  });
});
