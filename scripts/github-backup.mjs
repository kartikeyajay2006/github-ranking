// Off-site database snapshots stored as assets of a release in a private GitHub repository.
// For hosts without a persistent disk (e.g. Render's free plan): the app pushes every snapshot,
// and a fresh machine restores the newest one before it starts.
//
//   node scripts/github-backup.mjs push <file>   gzip + upload; keeps the newest BACKUP_REMOTE_KEEP (default 30), one per hour for 48 h, one per day for 30 days
//   node scripts/github-backup.mjs restore       if the database file is missing, download the newest snapshot
//   node scripts/github-backup.mjs list
//
// Env: BACKUP_REPO=owner/name (private), BACKUP_TOKEN or GITHUB_TOKEN with Contents read/write on it.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGunzip, createGzip } from "node:zlib";

const REPO = process.env.BACKUP_REPO;
const TOKEN = process.env.BACKUP_TOKEN || process.env.GITHUB_TOKEN;
const KEEP = Math.max(3, Number(process.env.BACKUP_REMOTE_KEEP ?? 30));
const TAG = process.env.BACKUP_TAG || "db-snapshots";
const DB = resolve(process.env.DATABASE_PATH || "data/ranking.db");
const log = (...a) => console.log("[github-backup]", ...a);

// Hosts like Render start the new server before stopping the old one. Each snapshot is labelled with the
// start time of the server that made it; the newest server's line always wins, and an older server stops
// copying as soon as a newer one has pushed, so its late writes can't overwrite newer data.
const BOOT = Number(process.env.BACKUP_INSTANCE_BOOT || 0);
const INSTANCE = (process.env.RENDER_INSTANCE_ID || hostname()).replace(/[^a-z0-9]/gi, "").slice(-12) || "local";
const bootOf = (name) => Number(/--b(\d+)-/.exec(name)?.[1] ?? 0);
const newestFirst = (a, b) => bootOf(b.name) - bootOf(a.name) || b.created_at.localeCompare(a.created_at) || b.id - a.id;

function api(path, init = {}) {
  const url = path.startsWith("https://") ? path : `https://api.github.com${path}`;
  return fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...init.headers },
    signal: AbortSignal.timeout(120_000),
  });
}

async function release(create) {
  let r = await api(`/repos/${REPO}/releases/tags/${TAG}`);
  if (r.status === 404 && create) {
    r = await api(`/repos/${REPO}/releases`, {
      method: "POST",
      body: JSON.stringify({ tag_name: TAG, name: "Database snapshots", body: "Automatic snapshots of the github-ranking database. Newest first.", prerelease: true }),
    });
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`release: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function assets(id) {
  const all = [];
  for (let page = 1; ; page++) {
    const r = await api(`/repos/${REPO}/releases/${id}/assets?per_page=100&page=${page}`);
    if (!r.ok) throw new Error(`assets: HTTP ${r.status}`);
    const batch = await r.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

async function push(file) {
  const rel = await release(true);
  const newer = (await assets(rel.id)).find((a) => bootOf(a.name) > BOOT);
  if (newer) return log(`a newer server is running (${newer.name}); this one no longer copies its data`);
  const name = `${basename(file, ".db")}--b${BOOT}-${INSTANCE}.db.gz`;
  // Compress through a temporary file: memory stays at the compressed size, not database + compressed.
  const gz = `${file}.gz`;
  await pipeline(createReadStream(file), createGzip({ level: 6 }), createWriteStream(gz));
  const body = readFileSync(gz);
  unlinkSync(gz);
  const up = await api(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/gzip" },
    body,
  });
  if (!up.ok && up.status !== 422) throw new Error(`upload: HTTP ${up.status} ${await up.text()}`);
  // Keep the newest KEEP, plus the newest of each hour for 48 hours and of each day for 30 days.
  const all = await assets(rel.id);
  const keep = new Set(all.slice(0, KEEP).map((a) => a.id));
  const seen = new Set();
  for (const a of all) {
    const age = Date.now() - Date.parse(a.created_at);
    const hour = `h${a.created_at.slice(0, 13)}`, day = `d${a.created_at.slice(0, 10)}`;
    if (age < 48 * 3_600_000 && !seen.has(hour)) (seen.add(hour), keep.add(a.id));
    if (age < 30 * 86_400_000 && !seen.has(day)) (seen.add(day), keep.add(a.id));
  }
  for (const old of all) if (!keep.has(old.id)) await api(`/repos/${REPO}/releases/assets/${old.id}`, { method: "DELETE" });
  log(`pushed ${name} (${(body.length / 1024).toFixed(0)} KB)`);
}

function healthy(file) {
  try {
    const c = new DatabaseSync(file, { readOnly: true });
    const ok = Object.values(c.prepare("PRAGMA quick_check").get())[0] === "ok";
    c.close();
    return ok;
  } catch {
    return false;
  }
}

async function restore() {
  if (existsSync(DB)) return log(`${DB} exists; nothing to restore`);
  const rel = await release(false);
  const list = rel ? await assets(rel.id) : [];
  if (!list.length) return log("no snapshots yet; starting with an empty database");
  list.sort(newestFirst);
  for (const a of list.slice(0, 5)) {
    const r = await api(`/repos/${REPO}/releases/assets/${a.id}`, { headers: { accept: "application/octet-stream" } });
    if (!r.ok) throw new Error(`download ${a.name}: HTTP ${r.status}`);
    const tmp = `${DB}.restoring`;
    mkdirSync(dirname(DB), { recursive: true });
    await pipeline(Readable.fromWeb(r.body), createGunzip(), createWriteStream(tmp));
    if (healthy(tmp)) {
      renameSync(tmp, DB);
      return log(`restored ${a.name}`);
    }
    unlinkSync(tmp);
    log(`${a.name} failed its integrity check; trying the previous one`);
  }
  throw new Error("no healthy snapshot among the newest five");
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (!REPO || !TOKEN) {
    if (cmd === "restore") return log("BACKUP_REPO or token not set; skipping restore");
    throw new Error("BACKUP_REPO and BACKUP_TOKEN (or GITHUB_TOKEN) are required");
  }
  if (cmd === "push") return push(file);
  if (cmd === "list") {
    const rel = await release(false);
    for (const a of rel ? await assets(rel.id) : []) console.log(a.created_at, a.name, a.size);
    return;
  }
  if (cmd === "restore") {
    // A failed restore must not start an empty app that would then push an empty snapshot as "newest".
    for (let attempt = 1; ; attempt++) {
      try {
        return await restore();
      } catch (err) {
        if (attempt >= 6) throw err;
        log(`restore attempt ${attempt} failed (${err.message}); retrying`);
        await new Promise((r) => setTimeout(r, attempt * 5000));
      }
    }
  }
  throw new Error("usage: github-backup.mjs push <file> | restore | list");
}

main().catch((err) => {
  console.error("[github-backup]", err.message);
  process.exit(1);
});
