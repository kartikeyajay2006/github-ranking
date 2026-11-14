# github-ranking · full guide

[← Back to the README](../README.md)

**Evidence-based assessment and ranking of GitHub developers and teams.**

Paste a username and get a score out of 100. Every point traces back to public GitHub evidence and a fixed, published rule. The score measures what the person **built themselves**: how good their projects are, how much of them they wrote, and what other maintainers accepted from them. Stars, followers and commit counts can be inflated, so they matter much less.

![Individual standings, dark theme](screenshots/standings-dark.png)

<table>
  <tr>
    <td width="50%"><img src="screenshots/profile-light.png" alt="Developer profile with the score ledger"></td>
    <td width="50%"><img src="screenshots/team-dark.png" alt="Team page with lead-weighted score composition"></td>
  </tr>
  <tr>
    <td align="center"><sub>Profile: every factor, its evidence and the points it earned</sub></td>
    <td align="center"><sub>Team: each member's weight × their own score</sub></td>
  </tr>
</table>

---

## Contents

- [Why](#why)
- [How a score is built](#how-a-score-is-built)
- [What counts as whose work](#what-counts-as-whose-work)
- [Teams](#teams)
- [Bulk upload](#bulk-upload)
- [Fairness guarantees](#fairness-guarantees)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Data safety](#data-safety)
- [Deployment](#deployment)
- [Capacity](#capacity)
- [Architecture](#architecture)
- [Development](#development)
- [Limitations](#limitations)
- [Roadmap](#roadmap)

---

## Why

The usual ways of judging a GitHub profile are easy to game:

| Common signal | How it gets inflated |
|---|---|
| Green squares, commit count | Many tiny commits; backdated commits |
| "Contributed to N repos" | PRs to your own organisation, self-merged PRs, Hacktoberfest "add your name" repos |
| Followers | Follow-for-follow |
| Number of repositories | Dozens of tutorial or empty repositories |

**github-ranking** reads what each person demonstrably built and what outside maintainers chose to accept. It then reports the result as a ledger: each factor, its evidence, its weight and its points, adding up to the total.

---

## How a score is built

Six dimensions, each scored 0–100 and weighted into a total. **55% of the score is building.**

| Dimension | Weight | Question it answers |
|---|---:|---|
| **Project quality** | 30% | Are their best projects well-engineered, documented, maintained and used? |
| **Build depth** | 25% | How much of those projects did *they* write, and how long did they stay with them? |
| **Activity & consistency** | 15% | Have they been working steadily over the last 12 months? |
| **Impact & reach** | 12% | Do other people use their work? |
| **Open-source contribution** | 10% | Has code they wrote been accepted into other people's projects? |
| **Engineering breadth** | 8% | Range of languages, substantial projects and collaborations |

**Bands:** Exceptional 75+ · Strong 60–75 · Proficient 50–60 · Developing 35–50 · Emerging 12–35 · Insufficient below 12 (too little public work to judge; never selected, whatever the cut-off).

Every count passes through a **saturating log curve** with a fixed target. Early progress counts a lot, later progress less, and nothing exceeds 100%. Example (stars, target 1,000):

| Stars | 0 | 10 | 100 | 1,000+ |
|---|---:|---:|---:|---:|
| Achievement | 0% | 35% | 67% | 100% |

<details>
<summary><b>Project quality (30%)</b>: the five best repositories, weighted 35 / 25 / 18 / 12 / 10%</summary>

Up to 24 owned repositories and 8 team repositories are inspected in depth. Each scores out of 100:

| Group | Points | Signals |
|---|---:|---|
| Documentation | 26 | README size (14, square-root curve to 4 KB), description (4), topics (2), homepage (3), docs folder or site generator (3) |
| Engineering hygiene | 30 | Test suite (10), CI configuration (9), licence (7), published releases (4) |
| Sustained development | 20 | Commits the person authored (14, log curve to 200), pushed within six months (6) |
| Adoption | 24 | Stars (18, log curve to 1,000), forks (6, log curve to 150) |

Each repository's score is then multiplied by an **authorship factor**, `min(1, 0.4 + 1.2 × share)`, where *share* is the fraction of default-branch commits the person wrote. Writing half or more earns full credit; writing a quarter earns 70%. Forks and the profile-README repository are excluded.
</details>

<details>
<summary><b>Build depth (25%)</b>: how much of their projects the person personally wrote</summary>

| Factor | Share | Measure |
|---|---:|---|
| Authored volume | 30% | Commits written across credited projects; log curve to 1,500 |
| Lead-built projects | 30% | Projects where they wrote ≥ 50% of commits, with 40+ commits; full at 5 |
| Sustained involvement | 25% | Distinct weeks with commits on their two longest-running projects (up to 500 commits read on the three busiest); full at 26 weeks |
| Authorship share | 15% | Portfolio-weighted share of their top five projects that is their own code |
</details>

<details>
<summary><b>Open-source contribution (10%)</b>: peer-reviewed work counts most</summary>

| Factor | Share | Measure |
|---|---:|---|
| Peer-reviewed PRs | 40% | Merged by an outside maintainer. Each is weighted by project stature (0.4 → 1.0 at 2,000★) × size of change (0.35 → 1.0 at 150 lines); log curve to 40 |
| Team & self-merged PRs | 15% | PRs in organisation or teammates' repositories, weighted by size; log curve to 60 |
| Repository reach | 15% | Distinct outside repositories that accepted their work; log curve to 15 |
| Project stature | 10% | Stars of the most prominent repository they landed a PR in; log curve to 20,000 |
| Acceptance rate | 10% | Outside merged ÷ decided, smoothed and discounted below ten PRs |
| Issues & reviews | 10% | In outside projects only; log curve to 60 |
</details>

<details>
<summary><b>Activity (15%), impact (12%), breadth (8%)</b></summary>

**Activity & consistency** (last 12 months): active days (35%, full at 220), weeks with activity (30%, out of 52), contribution volume (20%, log curve to 1,500), recency (15%, full within 14 days, zero at 180).

**Impact & reach:** stars earned (55%, log curve to 5,000), forks (20%, log curve to 500), repositories with 10+ stars (20%, log curve to 10), followers (**5%**, log curve to 1,000; deliberately minor).

**Engineering breadth:** distinct languages (40%, full at 8), repositories scoring 45+ on quality (35%, full at 8), other people's repositories they committed to, opened PRs in or reviewed this year (25%, full at 10).
</details>

The full specification also lives in the app at **`/method`**.

---

## What counts as whose work

Every merged pull request in a repository the person doesn't own is classified using GitHub's own author association and who merged it:

| Class | Rule | Where it's credited |
|---|---|---|
| **Outside** | Author is not an owner, member or collaborator, and someone else merged it | Open source, in full |
| **Team** | Author is a member or collaborator there, or merged their own PR | Smaller open-source factor; the repository counts under project quality and build depth, scaled by authorship |
| **Farm** | Repository exists to collect easy PRs (Hacktoberfest, first-contributions, contribution walls, question dumps) | 15% of an outside PR |

The same rule applies to issues and reviews: activity inside the person's own organisations doesn't count as outside engagement.

Each profile also splits the last 12 months into **own & team work** vs **outside contribution** and labels the person:

- **Builder-led:** at most 25% outside.
- **Contributor-led:** 60% or more outside.
- **Balanced:** anything in between.

The split describes how someone works; it doesn't add or remove points by itself.

---

## Teams

A team's score is the weighted mean of its members' **finished, independent** scores.

| Members | Lead-weighted (default) | Equal average |
|---:|---|---|
| 1 | 100% | 100% |
| 2 | 60 / 40 | 50 / 50 |
| 3 | 40 / 30 / 30 | 33.3 each |
| 4 | 30 / 23.3 / 23.3 / 23.3 | 25 each |
| 5 | 24 / 19 × 4 | 20 each |

The lead carries 1.2× an equal share (`1.2 / n`). Without a designated lead, a team uses the equal average. Members can be added at any time, from the team page or by creating a team with the same name again. Adding a member re-weights the team and never changes anyone's own score.

---

## Bulk upload

The **Upload** page ranks an entire application list at once.

1. **Give it the document:** an uploaded file (PDF, Word `.docx`, Excel `.xlsx`, CSV/TSV, text, Markdown, JSON, HTML), a link (Google Sheets, Google Docs, Google Drive or any public file), or pasted text.
2. **Check the extraction:** team names, leads, members, e-mails and GitHub accounts are read automatically. This covers Google Form exports, one-person-per-row sheets, "Team 1: …" documents, tables inside PDFs and Word files, and GitHub links hidden behind link text. Every team found is listed before anything runs. Optional AI extraction (Claude, needs `ANTHROPIC_API_KEY`) handles free-form documents.
3. **Rank in the background:** teams are processed one by one, three at a time, and each result is saved the moment it finishes. The ranking fills in live, survives restarts, and pauses by itself when GitHub's hourly limit runs out, then resumes.
4. **Select:** set a top-N cut-off, search, and export the ranking as CSV. Teams in the *Insufficient* band are never selected.

Members without a usable GitHub account (none given, or the account doesn't exist) **count as 0 by default**. They keep their share of the team's weight, so a team can't raise its score by leaving a weaker member's GitHub blank. "Leave them out" is available per import.

## Fairness guarantees

- **One person, one context.** An assessment reads a single account's data. No other participant is consulted, compared or used for normalisation.
- **Absolute thresholds.** Adding, removing or re-analysing anyone never moves another person's score; rankings are a plain sort.
- **Deterministic.** The same evidence always produces the same score. The scoring functions are pure and unit-tested.
- **Traceable.** Every profile shows the evidence behind each factor and notes anything that couldn't be measured, such as private contributions or very large histories.
- **Versioned.** Each assessment records its methodology version (currently `2026.11-r8`). Changing the rules bumps the version, and older snapshots are re-crawled the next time they're requested.

---

## Quick start

Requires **Node.js 22.13+**. Storage uses the built-in `node:sqlite`, so there are no native dependencies.

```bash
git clone https://github.com/kartikeyajay2006/github-ranking.git
cd github-ranking
npm install
cp .env.example .env    # add GITHUB_TOKEN, or skip if you're signed in with `gh`
npm run dev             # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | output of `gh auth token` | Token for GitHub's GraphQL API. Only public data is read, so a fine-grained token with no extra permissions is enough. |
| `DATABASE_PATH` | `data/ranking.db` | SQLite file holding analyses, standings and teams |
| `ANALYSIS_TTL_HOURS` | `12` | How long a stored analysis is reused before a fresh crawl |
| `ADMIN_PASSWORD` | unset | When set, every page and API requires HTTP Basic auth (user `ADMIN_USER`, default `admin`). Set it on any public deployment |
| `BACKUP_DIR` | `data/backups` | Where snapshots are kept |
| `BACKUP_INTERVAL_HOURS` | `1` | Snapshot interval while data is changing |
| `BACKUP_COMMAND` | unset | Shell command run after each snapshot (`$1` = file), for off-machine copies |
| `ANTHROPIC_API_KEY` | unset | Enables optional AI extraction on the Upload page |

---

## Data safety

All data lives in one SQLite file (`DATABASE_PATH`). It is protected in layers:

| Layer | What it does |
|---|---|
| Durable writes | WAL journal with `synchronous=FULL`: a committed write survives a crash or power loss |
| Snapshots | `VACUUM INTO` snapshots, consistent even while imports are writing: at start-up, every hour while data is changing, before schema migrations and before an import is deleted |
| Verification | Every snapshot passes an integrity check before it is kept; a failing one is discarded and logged |
| Rotation | The last 24 snapshots plus one per day for 14 days (`BACKUP_KEEP`, `BACKUP_KEEP_DAYS`; folder `BACKUP_DIR`, default `data/backups`) |
| Compact storage | Evidence is stored Brotli-compressed, about 7× smaller, so 15,000 people take roughly 100–300 MB |
| Off-machine copies | Optional `BACKUP_COMMAND` runs after each snapshot with its path as `$1`, e.g. `rclone copy "$1" remote:ranking/` |
| Self-repair | On start-up, a database that fails its integrity check is moved aside and the newest healthy snapshot is restored automatically |
| Clean shutdown | The write-ahead log is folded into the main file on exit, so the `.db` file alone is always a complete copy |

Maintenance commands:

```bash
npm run db -- check            # integrity check and row counts
npm run db -- backup           # verified snapshot now
npm run db -- list             # snapshots, newest first
npm run db -- restore <file>   # stop the app first; the current database is snapshotted before it is replaced
```

`GET /api/health` reports liveness, row counts, running imports and the time of the latest snapshot.

## Deployment

The app keeps its state in a SQLite file, so it needs **persistent disk**: a VM, or a container with a volume. Serverless platforms such as Vercel are not supported as-is, because their file systems are ephemeral.

**Always set `ADMIN_PASSWORD` on a public deployment.** Without it, anyone who can reach the app can add, remove and edit entries.

### Docker (any server)

```bash
cp .env.example .env              # GITHUB_TOKEN, ADMIN_PASSWORD, …
docker compose up -d --build      # http://<server>:3000, data in ./data
```

With automatic HTTPS for a domain pointed at the server:

```bash
SITE_ADDRESS=ranking.example.com docker compose -f docker-compose.prod.yml up -d --build
```

The image is a Next.js standalone server on Node 24 (~45 MB of app files). It runs as a non-root user, has a health check on `/api/health`, and checkpoints the database cleanly on shutdown.

### Render (free plan, one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/kartikeyajay2006/github-ranking)

`render.yaml` runs the app on Render's **free plan**. The free plan has no persistent disk, so:

- every snapshot (within a minute of any change, and one at shutdown) is gzipped and uploaded to a release in a **private GitHub repository** (`BACKUP_REPO`) by `scripts/github-backup.mjs`; the newest 30 are kept, plus one per hour for 48 hours and one per day for 30 days. Each copy is labelled with the start time of the server that made it, so during a deploy the new server's copies always win and the old server stops copying;
- on start, `github-backup.mjs restore` downloads the newest healthy snapshot before the app opens the database, and refuses to start empty if GitHub can't be reached;
- `.github/workflows/keep-awake.yml` pings `/api/health` every 10 minutes (set the repository variable `SITE_URL`), so the free instance doesn't sleep and background ranking keeps running.

`GITHUB_TOKEN` must be a fine-grained token with **Contents: read and write** on the backup repository (public data needs no extra permission). Render asks for it and for `ADMIN_PASSWORD` when the Blueprint is applied.

## Capacity

Measured against GitHub's GraphQL API and against a database of **5,000 teams / 15,000 people**, using the production server bundle:

| | Measured |
|---|---|
| Analysis time | ~7–8 s for a typical student account; up to ~35 s for very prolific ones |
| API cost | **~5 points** per typical account (down from 11–25 before query batching) |
| Throughput | GitHub allows 5,000 points/hour per token: **~800–1,000 people per hour**, so 5,000 teams of 3 take roughly a working day. The queue waits out the limit on its own |
| Storage | Evidence is compressed: ~20 KB per person, so 15,000 people take under 400 MB |
| Teams list (5,000 teams) | 70 ms per request; standings are cached until data changes |
| Live ranking (5,000 teams) | 130 ms page; each 3-second poll downloads only newly finished teams (~0.5 KB) |
| Search across 5,000 teams | ~130 ms in the browser |
| Load test | 1,112 requests across every page: **0 errors**; one user: every page under 150 ms; five concurrent users: 95% of requests under 0.6 s |

GitHub's terms don't allow pooling several accounts' tokens to get around the hourly limit.

## Architecture

```mermaid
flowchart LR
  A[Username] --> B[collect.ts<br/>one account only]
  B --> C[(GitHub GraphQL)]
  B --> D[ProfileEvidence]
  D --> E[individual.ts<br/>pure scoring]
  E --> F[Assessment<br/>ledger + notes]
  F --> G[(SQLite)]
  G --> H[team.ts<br/>weights finished scores]
  G --> I[Next.js pages]
  H --> I
```

```
src/
├─ lib/
│  ├─ github/client.ts       GraphQL client: token resolution, request gate, back-off, timeouts
│  ├─ github/collect.ts      Evidence for ONE login: profile, contributions, repository scan,
│  │                         deep inspection, team-repo discovery, PR/issue classification inputs
│  ├─ scoring/curves.ts      Saturating curves and helpers
│  ├─ scoring/individual.ts  Pure, deterministic scoring and the score ledger
│  ├─ scoring/team.ts        Team weights and weighted aggregation
│  ├─ analyze.ts             Collect → score → store, with freshness cache and de-duplication
│  ├─ imports/               Upload: readers (PDF, Word, Excel, CSV, links), extraction, AI extraction, job queue, worker
│  ├─ backup.ts              Verified snapshots, rotation, self-repair
│  ├─ standings.ts           Cached team standings
│  └─ store.ts, db.ts        SQLite persistence (compressed evidence, summaries, migrations)
├─ app/                      Next.js App Router pages and server actions
└─ components/               UI: standings, ledger, heatmap, forms, theme toggle
```

**Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, `node:sqlite`, Vitest. No UI framework or chart library; the visual system is a single stylesheet with light and dark themes and a colour-blind-safe palette.

---

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Unit tests for scoring, classification, authorship, team weights and parsing (no network) |
| `npm run typecheck` | TypeScript |
| `CALIBRATE=user1,user2 npm run calibrate` | Live run against real accounts; writes scores to `calibration.txt` |

When changing weights or rules, edit `src/lib/scoring/individual.ts`, bump `METHODOLOGY_VERSION`, update `/method`, and calibrate against a spread of real accounts (new, student, established, prolific) before shipping.

---

## Limitations

- **Public data only.** Private contributions appear in the activity calendar when the user has enabled it, but can't be inspected.
- **Team repositories** are found through merged PRs and the last 12 months of commits. An old organisation project with no recent activity isn't picked up.
- **Contribution farms** are recognised by repository name.
- **Tests** are detected at the repository root and in `src/test`. Tests nested deeper in a monorepo can be missed.
- **Commits from an e-mail not linked to the account** don't attribute to it. On repositories the person owns, half of the history is credited and the profile says so.
- **Very large histories:** the 200 most recent merged PRs are classified and the rest are assumed to follow the same mix. Commit dates are read up to 500 per project.
- **One account per person.** Work split across two GitHub accounts is assessed separately.

## Roadmap

- A pinned evaluation cut-off date, so long batch runs measure everyone over the same 12-month window
- A Postgres storage adapter for serverless hosting
- Per-organiser accounts instead of one shared admin password
