# 🗺️ Repository structure

This page is the directory map for `github-ranking`. It describes the purpose of each maintained area and gives contributors a reliable starting point for changes.

## 🌟 Top-level map

```text
github-ranking/
├── .github/                  GitHub Actions workflows
├── data/                     Local SQLite database and backups (runtime data; not source)
├── deploy/                   Reverse-proxy configuration
├── docs/                     Product, contributor, and operator documentation
├── scripts/                  Database and asset maintenance commands
├── src/                      Next.js application source
├── tests/                    Unit tests, live checks, and representative input fixtures
├── .env.example              Names and safe defaults for local configuration
├── Dockerfile                Multi-stage production container build
├── docker-compose.yml        Local/container runtime
├── docker-compose.prod.yml   Production container and HTTPS proxy setup
├── next.config.ts            Next.js framework configuration
├── package.json              Commands, runtime requirements, and dependencies
├── render.yaml               Render service blueprint
├── tsconfig.json             TypeScript compiler settings and `@/*` alias
└── vitest.config.ts          Vitest configuration
```

## 🧭 Application source

```text
src/
├── app/
│   ├── api/
│   │   ├── health/                       Public process and data health summary
│   │   ├── imports/[id]/                  Import progress JSON and CSV export
│   │   └── teams/export/                  Full team standings CSV export
│   ├── method/                            Public scoring methodology page
│   ├── teams/                             Team standings and individual team detail
│   ├── u/[login]/                         Individual GitHub assessment page
│   ├── upload/                            Document upload, extraction, and ranking
│   ├── actions.ts                         Individual and team server actions
│   ├── globals.css                        Shared responsive visual system and themes
│   ├── layout.tsx                         Application shell, fonts, theme, and masthead
│   └── page.tsx                           Individual standings landing page
├── components/                            Reusable interface components
│   ├── auto-refresh.tsx                   Refresh policy for live data views
│   ├── forms.tsx                           Individual/team forms and action controls
│   ├── heatmap.tsx                         Activity visualization
│   ├── imports.tsx                         Upload and live import controls
│   ├── masthead.tsx                        Primary navigation
│   ├── rate-footer.tsx                     GitHub API availability indicator
│   ├── theme-toggle.tsx                    Light, dark, and automatic theme controls
│   └── ui.tsx                              Shared score, band, avatar, and display primitives
├── lib/
│   ├── github/                             GitHub API access and evidence collection
│   ├── imports/                            Reading, extracting, scoring, and queueing imports
│   ├── scoring/                            Pure scoring rules and score dimensions
│   ├── analyze.ts                          Single-account analysis orchestration
│   ├── backup.ts                           SQLite snapshots, verification, and restore
│   ├── db.ts                               SQLite connection and schema migrations
│   ├── project.ts                          Best-project assessment support
│   ├── standings.ts                        Cached team standings and competition ranks
│   ├── store.ts                            Persistent profile/team/job data operations
│   ├── teamscore.ts                        Combine stored individual assessments for a team
│   └── types.ts                            Shared domain types
├── instrumentation.ts                      Process startup and background worker lifecycle
└── proxy.ts                                Optional HTTP Basic authentication gate
```

## 🧩 Feature boundaries

### 🟦 Web routes and page composition

`src/app/` follows the Next.js App Router convention. A folder containing `page.tsx` is a page route; a folder containing `route.ts` is a route handler. Dynamic segments use bracketed names such as `[id]` and `[login]`.

- Keep page-specific orchestration close to its route.
- Put reusable visual behavior in `src/components/`.
- Put domain rules and persistence operations in `src/lib/`.
- Keep request/response handling in route handlers under `src/app/api/`.
- Keep privileged mutations in server actions; validate form values before writing.

### 🟪 Scoring and analysis

`src/lib/github/collect.ts` gathers evidence for one account at a time. The individual scoring functions are in `src/lib/scoring/individual.ts`; reusable curves are in `curves.ts`. Project and team scoring each have their own module. `src/app/method/page.tsx` is the user-facing explanation of those rules.

**When a score rule changes:** update the implementation, methodology version, public Method page, and relevant documentation together. Do not add cohort-relative normalization: each person's assessment is intended to stand on its own evidence.

### 🟩 Imports and background processing

`src/lib/imports/` is split by responsibility:

- `read.ts` extracts text and tables from uploaded files and supported links.
- `extract.ts` turns source content into normalized teams and members.
- `ai.ts` handles optional assisted extraction for free-form documents.
- `jobs.ts` stores import lifecycle and result information.
- `worker.ts` processes queued team analyses and persists progress.

The matching interface lives in `src/app/upload/` and `src/components/imports.tsx`. A document is first previewed; only after confirmation does a ranking job begin.

### 🟨 Persistence and operations

`db.ts` owns the SQLite connection and schema setup. `store.ts` owns data access for profiles and teams. `backup.ts` creates verified snapshots and restores a healthy copy when possible. `scripts/github-backup.mjs` is the Render-compatible off-machine backup adapter.

Runtime data belongs under `data/` locally or on the configured persistent data path in production. It is not source code and should not be moved into `src/` or included in a commit.

## 🎨 Documentation and assets

```text
docs/
├── assets/
│   ├── brand/                Generated README SVGs, light and dark
│   └── screenshots/          Product screenshots used by the guide
├── guides/                   Long-form product and operator guides
├── reference/                Repository and implementation maps
└── README.md                 Documentation hub and contribution entry point
```

The artwork generator is `scripts/readme-art.mjs`; its output belongs in `docs/assets/brand/`. Update links when moving assets. Screenshots are manually captured and belong in `docs/assets/screenshots/`.

## 🧪 Tests and fixtures

```text
tests/
├── fixtures/imports/         Small representative input documents and spreadsheets
├── support/                  Test setup helpers
├── *.test.ts                 Deterministic local unit tests
└── *.live.test.ts            Explicitly network-dependent checks
```

Fixtures make parsing behavior reproducible without external services. Keep live tests clearly named and separate from the default test run.

## 🔀 Where common changes belong

| Change | Primary location | Keep in sync |
|---|---|---|
| New page or endpoint | `src/app/` | `src/components/`, `docs/` if user-facing behavior changes |
| Shared UI element | `src/components/` | `src/app/globals.css` for visual rules |
| Score factor or weight | `src/lib/scoring/` | Method page, methodology version, scoring guide |
| GitHub data collected | `src/lib/github/` | Evidence types, score behavior, limitations |
| Upload parsing behavior | `src/lib/imports/read.ts` or `extract.ts` | Fixtures and format documentation |
| Import queue behavior | `src/lib/imports/jobs.ts` or `worker.ts` | Upload interface and operations guide |
| Database schema or data access | `src/lib/db.ts` or `store.ts` | Backups and migration notes |
| Deployment/runtime behavior | `Dockerfile`, compose files, `render.yaml`, `deploy/` | Operator guide and `.env.example` |
| Branded README artwork | `scripts/readme-art.mjs` | `docs/assets/brand/` and root README links |

## 📦 Root files at a glance

- `package.json` is the command and dependency index. Do not add a dependency for a capability already present in the stack without a clear need.
- `package-lock.json` pins the npm dependency graph; update it with package manifest changes.
- `next.config.ts` configures framework behavior, body-size limits, image hosts, and Docker standalone output.
- `tsconfig.json` is strict TypeScript configuration. The `@/*` alias resolves into `src/*`.
- `vitest.config.ts` separates the fast local test suite from explicitly live checks.
- `.env.example` documents variable names without containing real credentials.
- `render.yaml`, Docker, and Compose files describe distinct deployment paths; edit the path that is actually being used.

## 🛡️ Repository hygiene

- Keep secrets and production data out of Git.
- Keep generated build output such as `.next/` and `node_modules/` out of source control.
- Prefer a feature-local module over a new miscellaneous root directory.
- Update README and guide links when moving documentation or artwork.
- Make one conceptual change per commit so each stage is easy to review and roll back.

