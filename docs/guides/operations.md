# 🛡️ Operations handbook

> Practical guidance for configuring, starting, protecting, backing up, restoring, and monitoring an instance.

## 🧭 Operating model

github-ranking is a server-rendered Next.js application backed by one local SQLite database. It is designed for a persistent Node.js process or a container with durable storage. A serverless environment with an ephemeral filesystem cannot preserve application state without an additional storage adapter.

- 🟢 Application pages and data actions run on the server.
- 🔵 GitHub requests use a server-side token or the GitHub CLI credential available to the process.
- 🟣 SQLite stores evidence, assessments, standings, teams, imports, and cached project evidence.
- 🟠 The process creates verified database snapshots and can copy them off-machine.
- 🔴 Public network access should be protected with `ADMIN_PASSWORD`.

## 🚀 Local start

1. Install Node.js 22.13 or newer. Node 24 is used in the production container.
2. Clone the repository and install dependencies with `npm ci`.
3. Copy `.env.example` to `.env` and set a GitHub token if the process cannot use `gh auth token`.
4. Set a local admin password if other people can reach the host.
5. Run `npm run dev` for development or `npm run build && npm start` for a production-like local server.
6. Use `http://localhost:3000`, unless `PORT` was changed.

Do not put real credentials in source files. The `.env` file must remain ignored by Git. `.env.example` documents variable names and safe defaults only.

## 🔑 Environment reference

| Variable | Default | Purpose and operational notes |
|---|---|---|
| `GITHUB_TOKEN` | `gh auth token` fallback | Server-side GraphQL token for public profile/repository reads. Provide an appropriately scoped token for the backup repository only when that feature is used. |
| `DATABASE_PATH` | `data/ranking.db` | SQLite database location. Use persistent storage in production. |
| `ANALYSIS_TTL_HOURS` | `12` | How long a stored profile remains reusable if its methodology version still matches. |
| `ADMIN_PASSWORD` | Unset | Enables Basic authentication for matched app pages and APIs. Required for a public deployment. |
| `ADMIN_USER` | `admin` | Basic-auth username used with `ADMIN_PASSWORD`. |
| `BACKUP_DIR` | Sibling `backups` directory | Local verified snapshot directory. |
| `BACKUP_INTERVAL_HOURS` | `1` | Snapshot check interval with durable local storage. |
| `BACKUP_KEEP` | `24` | Number of most recent snapshots retained. Minimum effective value is one. |
| `BACKUP_KEEP_DAYS` | `14` | Additional daily snapshots retained over this number of days. |
| `BACKUP_COMMAND` | Unset | Optional shell command invoked with the snapshot path as its first positional argument. |
| `BACKUP_DISABLED` | Unset | When set to `1`, turns off scheduled and shutdown backup activity. Use intentionally. |
| `BACKUP_INSTANCE_BOOT` | Current process boot timestamp | Identifies the process that made off-site copies. The Render backup adapter uses it to distinguish instances during deploy overlap. |
| `ANTHROPIC_API_KEY` / auth variables | Unset | Enables optional assisted extraction for free-form documents. Credentials remain server-side. |
| `RENDER_EXTERNAL_URL` | Render-provided | Used while imports are active to keep background ranking from sleeping on the free instance. |
| `PUBLIC_URL` | Unset | Alternative public base URL for the keep-awake worker behavior. |
| `PORT` | `3000` | HTTP listener port. |
| `HOSTNAME` | Host runtime default | Container deployment binds to `0.0.0.0`. |
| `NEXT_TELEMETRY_DISABLED` | Unset | Set to `1` in production recipes to disable framework telemetry. |

The application health endpoint, `GET /api/health`, is intentionally excluded from Basic auth so an uptime monitor can determine whether the service and database are usable. It returns counts and backup time, not personal profile detail.

## 🔐 Access control and secrets

### HTTP Basic authentication

`src/proxy.ts` gates the application when `ADMIN_PASSWORD` is present. Set `ADMIN_USER` for a non-default username. Use TLS in front of Basic auth; credentials are only base64-encoded by the protocol and must be protected in transit.

- 🟥 Set a unique long password in the deployment platform's secret store.
- 🟥 Rotate credentials if they are shared with someone who should no longer have access.
- 🟥 Avoid embedding a password in a repository variable that is visible to untrusted workflows.
- 🟥 Health checks remain open so hosts can monitor the process without the password.
- 🟥 The current model is a shared administrator credential, not per-user identity or audit logs.

### GitHub credentials

- 🔵 Use a token with only the permissions necessary for the chosen deployment.
- 🔵 Public profile scoring reads public evidence. A fine-grained token does not need write scopes for analysis.
- 🔵 The Render off-site backup repository requires contents read/write access for the backup adapter.
- 🔵 Do not print tokens in logs or add them to generated `.env` snippets in documentation.
- 🔵 GitHub rate limits are shared by analyses using the same token; the worker waits rather than bypassing limits with multiple accounts.

### Optional AI extraction

Configure the provider credential only when assisted extraction is wanted. The upload page indicates whether the server has a credential. The reader's deterministic path does not need an AI provider.

- 🟣 Treat input documents as potentially sensitive.
- 🟣 Confirm that the provider and account policy permit transmitting that text.
- 🟣 Review the returned draft before running a ranking job.
- 🟣 Keep the AI key on the server, never as a `NEXT_PUBLIC_` variable.

## 💾 Database and durability

SQLite runs in WAL mode with foreign keys enabled, a full synchronous durability setting, and a finite busy timeout for brief external locks.

- 🟢 A committed transaction should survive a process or machine interruption supported by the underlying storage.
- 🟢 Profiles store compressed evidence, a scored assessment, summary data, methodology version, and analysis timestamp.
- 🟢 Team membership is stored separately from team records; import jobs and imported teams retain their source-specific information.
- 🟢 Schema upgrades are additive and check whether a column exists before applying the corresponding migration.
- 🟢 If a schema migration is needed while profiles already exist, a pre-migration snapshot is made first.
- 🟠 Never copy a live database without including its WAL state unless the application is stopped or a SQLite-consistent backup method is used.
- 🟠 Runtime database files belong on a persistent volume and must not be committed.

## 📦 Snapshot behavior

The backup module creates a consistent snapshot using `VACUUM INTO`, then opens the copy read-only and runs a quick integrity check. A failed snapshot is discarded rather than kept as a restore point.

Snapshots can happen:

- 🟦 At startup when the current database differs from the latest snapshot.
- 🟦 On the configured interval while the database has changed.
- 🟦 Before schema migration when existing profile records are present.
- 🟦 Before destructive import deletion.
- 🟦 At clean shutdown for an off-site-copy deployment when changed data needs a final copy.

Rotation keeps recent snapshots and one per UTC day within the configured retention window. Local backup retention is not the same as application row retention; a backup can contain records that have since been deleted from the live database.

## ♻️ Restore and recovery

The database opens lazily through `db()`. Before use, it checks whether an existing database passes SQLite's quick integrity check. If not:

1. 🟠 Move the corrupt main file and any WAL/SHM companions aside with a timestamp.
2. 🟠 Find the newest healthy local snapshot.
3. 🟠 Rebuild the database from that snapshot.
4. 🟠 If none is healthy, log the situation and start a new database rather than opening the corrupt one.

For a manual restore, stop the application first. `npm run db -- restore <snapshot>` snapshots the current database before replacement. Check the CLI output, then restart and verify `/api/health` plus the expected profile/team/import counts.

### Database maintenance commands

```bash
npm run db -- check
npm run db -- backup
npm run db -- list
npm run db -- restore /path/to/ranking-20261119.db
```

- 🟢 `check` reports an integrity result and table counts.
- 🟢 `backup` creates a verified snapshot immediately.
- 🟢 `list` displays snapshots newest first.
- 🟠 `restore` replaces live data and should only run while the application is stopped.

## 🐳 Docker deployment

The Dockerfile has dependency, build, and runtime stages. The final stage copies Next.js standalone output, static assets, and required scripts into a Node 24 image and runs as a non-root account.

```bash
cp .env.example .env
# Edit .env with GITHUB_TOKEN and ADMIN_PASSWORD.
docker compose up -d --build
```

The Compose configuration persists `./data` and exposes port 3000. For a public domain with HTTPS, use the production Compose file and configure `SITE_ADDRESS` to a domain already pointed at the server.

### Container operating notes

- 🟦 Keep the mounted data directory writable by the configured container user.
- 🟦 Preserve the volume when replacing the image.
- 🟦 Monitor the `/api/health` health check.
- 🟦 Send SIGTERM for orderly shutdown so the database can checkpoint and off-site backups can finish.
- 🟦 Build output is standalone only when `BUILD_STANDALONE=1` is set, as the Docker build stage does.

## ☁️ Render deployment

`render.yaml` describes a free Node service in Singapore with `main` as its deployment branch, a production build command, start command, and `/api/health` check. `autoDeploy` is enabled.

The free plan does not provide persistent disk. Its data path depends on the private backup repository workflow:

1. 🟣 `scripts/github-backup.mjs restore` downloads the latest valid remote snapshot before the app starts.
2. 🟣 While data changes, the backup command runs at a short interval and uploads a compressed release asset.
3. 🟣 On clean shutdown, a final copy is attempted.
4. 🟣 The adapter keeps a bounded set of recent and historical snapshots.
5. 🟣 A process-boot marker ensures a newly deployed instance takes precedence over the old instance during overlap.

Required platform secrets include the admin password and GitHub token. The token used by the backup adapter needs write access to the private data repository. The application repository can be public while applicant data remains in the separate private repository.

The Keep awake GitHub Action reads the repository variable `SITE_URL` and pings `<SITE_URL>/api/health` every ten minutes. Configure the variable to the deployed base URL. During an active ranking, the worker also pings its public URL so a sleeping free instance can continue processing; when idle, it may sleep.

### After a push

- 🟢 Confirm the deployment record points at the expected commit.
- 🟢 Wait for the provider's build and deployment state to become successful.
- 🟢 Request `/api/health` and look for `ok: true`.
- 🟢 For a protected application route, expect the configured authentication challenge unless valid credentials are supplied.
- 🟢 Review provider logs for build errors, restore failures, missing environment variables, or repeated backup errors.
- 🟠 Do not mark a deployment as functionally verified using health alone: the health endpoint does not render the UI or download a CSV.

## 📈 Monitoring and incident response

### Health response

The response includes:

- `ok`: whether the database could be opened and queried.
- `profiles`: number of stored profile records.
- `teams`: number of stored teams.
- `imports`: number of import jobs.
- `runningImports`: jobs currently marked running.
- `lastBackup`: timestamp of the latest local snapshot, or `null`.

Health does not reveal profile names or evidence. A `503` response means the database or health query could not be completed.

### Basic incident order

1. 🔴 Capture the current error message and deployment commit.
2. 🔴 Check the service health endpoint.
3. 🔴 Check provider logs, especially database restore, GitHub authentication, rate-limit, and backup lines.
4. 🔴 Confirm storage and secrets are configured before restarting repeatedly.
5. 🔴 If the database fails integrity, preserve the corrupt file and restore from the newest healthy snapshot.
6. 🔴 Confirm the app and the data counts after recovery.
7. 🔴 Record the cause and update this guide when the recovery procedure changes.

## 🧯 Common production failures

| Symptom | Likely cause | First safe response |
|---|---|---|
| Repeated GitHub authentication failures | Missing, expired, or invalid token. | Fix the secret; let the queue retry rather than deleting the import. |
| Queue waits with a rate-limit note | Hourly GitHub API budget is exhausted. | Wait for reset; do not add unrelated tokens to evade limits. |
| Empty database after a free-host deploy | Remote backup repository unavailable or not configured. | Inspect restore logs and backup repo permissions before allowing new writes. |
| Health is `503` | SQLite open/integrity/query error. | Inspect logs and local backups; preserve data before recovery actions. |
| Page returns `401` | Basic authentication is active. | Use the authorized credentials; do not turn off auth to make a monitor pass. |
| Private document cannot be imported | Link requires login. | Upload a permitted local export or adjust sharing. |
| Service sleeps while idle | Free service plan behavior. | Configure `SITE_URL`; expect sleep when no ranking work is active. |
| Container cannot write DB | Volume ownership or mount path mismatch. | Correct persistent volume permissions without deleting the volume. |

