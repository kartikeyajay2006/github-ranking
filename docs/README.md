# 🧭 github-ranking documentation

> **A field guide to the product, its code, and the way it is operated.**
> Start with the overview that matches your task, then follow the links to the deeper reference.

## 🌈 Documentation map

| Area | Start here | What it covers |
|---|---|---|
| 🟦 Product and scoring | [Full guide](guides/full-guide.md) | Product purpose, score dimensions, team weighting, file uploads, fairness, configuration, backups, deployment, capacity, architecture, and limitations. |
| 🌈 App user guide | [App handbook](guides/app-handbook.md) | Page-by-page tour of Individuals, Teams, Upload, Method, Docs, themes, search, and exports. |
| 🧮 Scoring details | [Scoring reference](guides/scoring-reference.md) | Dimension weights, curves, authorship, imported projects, team aggregation, bands, and update checklist. |
| 🟠 Competition imports | [Imports handbook](guides/imports-and-ranking.md) | Supported formats, extraction, policy choices, queue state, ranking controls, and troubleshooting. |
| 🛡️ Operations | [Operations handbook](guides/operations.md) | Access, configuration, SQLite, backup, Docker, Render, health, and recovery. |
| 🟩 Repository | [Repository structure](reference/repository-structure.md) | The complete project tree, ownership of each folder, and where changes belong. |
| 🧱 Data and HTTP | [Data model and API](reference/data-model-and-api.md) | Tables, migrations, route contracts, authentication, caching, and exports. |
| 🧑‍💻 Contributor | [Contributor workflow](reference/contributor-workflow.md) | Practical checklists for changing scoring, imports, persistence, UI, and deployment. |
| 🟨 Images and brand | [Asset library](assets/README.md) | Screenshots, README illustrations, and how the branded SVGs are generated. |
| 🟪 Local development | [Full guide: Quick start](guides/full-guide.md#quick-start) | Requirements, environment configuration, local commands, and development workflow. |
| 🟥 Operations | [Full guide: Data safety](guides/full-guide.md#data-safety) · [Deployment](guides/full-guide.md#deployment) | SQLite durability, snapshots, backup restore, Docker, Render, health checks, and operational limits. |
| 🟧 Scoring | [Methodology in the app](/method) · [Full guide: How a score is built](guides/full-guide.md#how-a-score-is-built) | Public scoring rules and implementation locations. |

## 🚦 Choose a path

- **New to the project?** Read the [product overview](../README.md), then the [full guide](guides/full-guide.md).
- **Using the app?** Follow the [App handbook](guides/app-handbook.md) and the [Imports handbook](guides/imports-and-ranking.md).
- **Reading in the browser?** Open the [interactive Docs section](/docs), filter by topic, follow its table of contents, and adjust text size.
- **Running the service?** Use the [Operations handbook](guides/operations.md).
- **Changing behavior?** Read the [Contributor workflow](reference/contributor-workflow.md) before editing.
- **Changing a feature?** Use the [repository map](reference/repository-structure.md) to find the correct layer before editing.
- **Changing scoring?** Read the [methodology](../src/app/method/page.tsx) and the scoring modules listed in the [repository map](reference/repository-structure.md#scoring-and-analysis).
- **Running a deployment?** Follow [configuration and deployment](guides/full-guide.md#configuration) and review the backup section before exposing the site.
- **Updating illustrations?** Use the [asset library](assets/README.md) and `npm run` the project’s image-generation script directly with Node.

## 🎨 Reading conventions

- 🟢 **Safe to do locally:** read, develop, and build without connecting to GitHub.
- 🔵 **Uses external services:** a live GitHub analysis or backup needs its configured token and network access.
- 🟠 **Changes stored data:** database restore, import deletion, and schema operations deserve an explicit backup.
- 🟣 **Scoring behavior:** a rule change must be reflected in the code and in the public Method page.

> **Accuracy note:** code and deployment configuration are the source of truth. If an explanation here disagrees with a current implementation, update the explanation alongside the code change.

## 🗂️ Documentation and asset conventions

- `guides/` contains end-to-end explanations written for product users and operators.
- `reference/` contains maps and technical facts intended to help contributors navigate the implementation.
- `assets/brand/` contains generated light and dark README artwork.
- `assets/screenshots/` contains product screenshots used in the guide.
- Root `README.md` stays concise: it introduces the project and links into this hub.

