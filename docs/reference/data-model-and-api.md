# 🧱 Data model and HTTP reference

> An implementation-oriented map of persisted records and the small HTTP surface exposed by the application.

## 🗃️ Persistence overview

SQLite is owned by `src/lib/db.ts`; the connection is process-global so hot reloads and route handlers share one database handle. Foreign keys are enabled, the journal is WAL, synchronous writes use `FULL`, and a five-second busy timeout accommodates brief maintenance locks.

| Table | Responsibility | Key relationships |
|---|---|---|
| `profiles` | Stored account evidence, assessment, total, methodology, summary, and analysis time. | Primary key is GitHub login, case-insensitive. |
| `individuals` | Accounts currently included in the Individual standings. | References `profiles(login)` and cascades when the profile is removed. |
| `teams` | Team identity, name, weighting mode, leader, import source, and absent member list. | Team ID is primary key; imported teams reference an import job. |
| `team_members` | GitHub accounts attached to a team with add timestamps. | Composite primary key `(team_id, login)`; team deletion cascades. |
| `import_jobs` | Uploaded source label, policies, lifecycle status, cut-off, and queue notes. | One job has many `import_teams`. |
| `import_teams` | Extracted registration record and per-team analysis state/results. | Composite key `(job_id, idx)`; job deletion cascades. |
| `project_cache` | Cached best-project evidence with fetch time. | Keyed by the project's normalized identity. |

### Stored profiles

- 🟢 `evidence` contains the collected public facts needed to reproduce an assessment.
- 🟢 `assessment` contains dimension scores, factors, notes, repository results, and pull-request classification.
- 🟢 `summary` holds a smaller view for team and standings queries.
- 🟢 `total` and `methodology` support sorting and cache/version decisions without decoding every large evidence object.
- 🟢 The login key uses SQLite's `NOCASE` collation so case-only variants do not create duplicate profiles.

### Team identity

Teams have independent IDs even if names match. A manual team is distinguished from an import-managed team by its `job_id`. The normalized member set is stored in `team_members`; for imported registrations, `absent` stores names/handles that do not have a usable GitHub profile but may still count in the team scoring policy.

### Import records

An `import_jobs` row stores the high-level policy and status. Each `import_teams` row stores its original index, extracted name/members, warnings, selected leader index, current status, linked team ID, final score/band, error, completion time, detailed score breakdown, attempts, and retry time.

The JSON columns preserve source-shaped records and structured breakdowns. Changes to their shape must be backward-compatible or accompanied by a migration/normalization step.

## 🔄 Startup and migration behavior

1. 🟦 Resolve `DATABASE_PATH` and create its parent directory.
2. 🟦 Check an existing database's integrity; attempt restore from a healthy local snapshot if corrupt.
3. 🟦 Open the SQLite database and apply the base schema with `CREATE TABLE IF NOT EXISTS`.
4. 🟦 Check required columns and apply additive migrations.
5. 🟦 Take a pre-migration snapshot when the database already contains profile data and a migration is pending.
6. 🟦 Schedule backups and register a clean process-exit checkpoint/close.

The migration function intentionally tests for each column before adding it so it can upgrade databases created by older versions. It is not a general migration framework; destructive schema rewrites should be designed carefully and documented.

## 🧭 HTTP routes

| Method | Route | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/health` | Public by design | Liveness/database summary; returns 503 when it cannot query storage. |
| `GET` | `/api/imports/[id]` | Basic auth if configured | Current import job/progress payload for live updates. |
| `GET` | `/api/imports/[id]/export` | Basic auth if configured | Detailed CSV export for one import, including ranked and unfinished teams. |
| `GET` | `/api/teams/export` | Basic auth if configured | Complete current team standings CSV. |
| `GET` | `/docs/assets/[...asset]` | Basic auth if configured | Allowlisted local SVG/PNG documentation assets, served with image MIME types. |

Page routes and API route handlers live together under `src/app/`, following the App Router convention. `src/proxy.ts` applies the optional Basic-auth gate to all matching pages and APIs except health and static framework assets.

## 🩺 Health response

Successful response example:

```json
{
  "ok": true,
  "profiles": 1754,
  "teams": 568,
  "imports": 1,
  "runningImports": 0,
  "lastBackup": "2026-11-19T09:06:11.703Z"
}
```

- 🟢 `lastBackup` is based on the newest local snapshot file.
- 🟢 The endpoint is intentionally small and avoids names, logins, or evidence.
- 🟠 Health does not prove that protected pages, CSV exports, GitHub collection, or offsite backup upload all work.
- 🟠 A valid database query is required; a process that starts but cannot access SQLite is unhealthy.

## 📄 Team standings CSV

Route: `GET /api/teams/export`

The export uses `teamStandings()` as the source, so it shares score ordering, imported score overrides, duplicate team suppression, and competition-rank semantics with the Teams page.

| Column | Value |
|---|---|
| `Rank` | First position for the exact score; ties share a number and later rank numbers skip tied rows. |
| `Team name` | Display name for the team. |
| `Leader name` | Source name when available; otherwise a `@login` fallback for manually managed teams. |
| `Leader GitHub` | Leader's GitHub login when one exists. |
| `Member names` | Semicolon-delimited source names/handle fallbacks. |
| `Member GitHub usernames` | Semicolon-delimited handles for usable accounts. |
| `Total score` | Team total at one decimal place; empty if no result exists. |

Every CSV field is quoted, embedded quote characters are doubled, and values starting with spreadsheet formula characters are prefixed with an apostrophe. The response uses `text/csv; charset=utf-8`, a UTF-8 BOM, a stable attachment filename, and `Cache-Control: no-store`.

## 🧾 Import CSV

Route: `GET /api/imports/[id]/export`

The import export is intentionally more detailed than the overall standings export. Completed teams are sorted from rank 1 through N. The `Team, leader & members` cell groups the team name, leader and full member roster, with each person's blended score next to their name. `Overall team score` is a separate column. `Leader email` contains only the designated leader's email; `Other members' emails` and `Other members' colleges` exclude the leader. College information is extracted from structured registration rows where present, so older stored imports may have an empty college field. Remaining columns include band, selection, GitHub and project scores, project links, member score components, status, notes, and scoring policy. Unfinished teams follow the ranked rows without a rank.

Use the import export when an organizer needs audit/detail; use the team standings export for a concise cross-import leaderboard.

## 🔐 Authentication behavior

When `ADMIN_PASSWORD` is empty, the proxy permits app traffic. When set:

- 🔴 The request must contain valid Basic credentials.
- 🔴 `ADMIN_USER` defaults to `admin`.
- 🔴 A rejected request receives status 401 and a `WWW-Authenticate` challenge.
- 🔴 The public health endpoint remains open by design.
- 🔴 Authentication applies to server actions through their page requests as part of the app access boundary.

Use HTTPS. Basic auth is shared-instance access control and does not identify which administrator performed an action.

## 🧵 Cache and consistency

- 🟢 Profile freshness is checked against `ANALYSIS_TTL_HOURS` and the methodology version.
- 🟢 An in-flight map coalesces simultaneous analysis requests for the same login.
- 🟢 Team standings are cached against SQLite `total_changes()` and rebuilt after a write.
- 🟢 Each import team's result is committed before the worker moves on.
- 🟠 The SQLite database is the source of truth; the in-memory cache is disposable and rebuilt after restart.
- 🟠 A cached team ranking must not be used to edit or overwrite a member's individual assessment.

## 📍 Code ownership map

- `src/lib/db.ts`: connection, schema, additive migrations, transactions.
- `src/lib/store.ts`: profile/team/project persistence and queries.
- `src/lib/standings.ts`: complete standings, duplicate filtering, sorting, competition ranks, cache.
- `src/lib/teamscore.ts`: aggregate stored profile summaries for a team.
- `src/lib/imports/jobs.ts`: import job state and transitions.
- `src/lib/imports/worker.ts`: background queue and retry behavior.
- `src/lib/backup.ts`: local snapshots, integrity checks, rotation, and repair.
- `src/app/api/`: HTTP request/response code and downloads.
- `src/proxy.ts`: auth boundary for pages and APIs.

