#!/usr/bin/env node
// Database maintenance for github-ranking.
//   npm run db -- backup            consistent, verified snapshot now
//   npm run db -- list              snapshots, newest first
//   npm run db -- check             integrity check of the live database
//   npm run db -- restore <file>    replace the database with a snapshot (stop the app first)
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbFile = resolve(process.env.DATABASE_PATH || "data/ranking.db");
const dir = resolve(process.env.BACKUP_DIR || join(dirname(dbFile), "backups"));
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
const quick = (file) => {
  try {
    const c = new DatabaseSync(file, { readOnly: true });
    const r = Object.values(c.prepare("PRAGMA quick_check").get())[0];
    c.close();
    return r;
  } catch (e) {
    return e.message;
  }
};
const snapshot = (reason) => {
  if (!existsSync(dbFile)) throw new Error(`No database at ${dbFile}`);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `ranking-${stamp()}-${reason}.db`);
  const c = new DatabaseSync(dbFile);
  c.exec("PRAGMA busy_timeout = 10000");
  c.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  c.close();
  const ok = quick(out);
  if (ok !== "ok") throw new Error(`Snapshot failed its integrity check: ${ok}`);
  return out;
};

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "backup") {
    console.log(`Saved ${snapshot("manual")}`);
  } else if (cmd === "list") {
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".db")).map((f) => ({ f, st: statSync(join(dir, f)) })) : [];
    files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    for (const { f, st } of files) console.log(`${new Date(st.mtimeMs).toISOString()}  ${(st.size / 1024).toFixed(0).padStart(8)} KB  ${join(dir, f)}`);
    if (!files.length) console.log(`No snapshots in ${dir}`);
  } else if (cmd === "check") {
    const r = quick(dbFile);
    const c = new DatabaseSync(dbFile, { readOnly: true });
    const tables = new Set(c.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const n = (t) => (tables.has(t) ? c.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : "–");
    console.log(`${dbFile}: ${r}\nprofiles ${n("profiles")} · individuals ${n("individuals")} · teams ${n("teams")} · imports ${n("import_jobs")} · import rows ${n("import_teams")}`);
    c.close();
    if (r !== "ok") process.exitCode = 1;
  } else if (cmd === "restore") {
    const src = resolve(arg ?? "");
    if (!arg || !existsSync(src)) throw new Error("Usage: npm run db -- restore <snapshot file>");
    const r = quick(src);
    if (r !== "ok") throw new Error(`${basename(src)} failed its integrity check: ${r}`);
    if (existsSync(dbFile)) console.log(`Current database saved as ${snapshot("before-restore")}`);
    const tmp = `${dbFile}.restoring`;
    copyFileSync(src, tmp);
    for (const s of ["-wal", "-shm"]) rmSync(dbFile + s, { force: true });
    renameSync(tmp, dbFile);
    console.log(`Restored ${dbFile} from ${basename(src)}. Start the app again.`);
  } else {
    console.log("Usage: npm run db -- backup | list | check | restore <file>");
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
