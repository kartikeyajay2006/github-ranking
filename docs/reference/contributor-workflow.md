# 🧑‍💻 Contributor workflow

> A compact guide to making changes that fit the existing architecture and remain understandable after they ship.

## 🌿 Before editing

- 🟢 Start at the [repository map](repository-structure.md).
- 🟢 Check the current Git status and preserve work that is not yours.
- 🟢 Read the local `AGENTS.md` instructions. The repository uses a Next.js version whose conventions differ from older releases; consult the installed Next.js docs when changing framework behavior.
- 🟢 Identify which layer owns the behavior: route, component, domain logic, persistence, or infrastructure.
- 🟢 Search for existing behavior before adding another helper or dependency.
- 🟢 Keep user-facing language consistent with the Method page and full guide.

## 🧩 Change shape

Prefer changes that have one clear responsibility:

1. 🔵 Keep page routing and page composition in `src/app/`.
2. 🔵 Put repeated UI in `src/components/`.
3. 🔵 Put pure rules in `src/lib/` and keep them independent from React.
4. 🔵 Put SQLite reads and writes behind `src/lib/store.ts` or a specific domain module.
5. 🔵 Keep import reading, extraction, lifecycle, and worker behavior in their existing submodules.
6. 🔵 Keep runtime/deployment configuration in the root configuration files or `deploy/`.
7. 🔵 Update a guide when user behavior, operation, or contributor navigation changes.

Avoid introducing a general `utils.ts` dumping ground. A small named module communicates why its code exists.

## 🧮 Scoring change checklist

- 🟣 Confirm the factor belongs to the correct dimension and its weight is accounted for.
- 🟣 Normalize inputs using the existing curve helpers.
- 🟣 Keep the function deterministic by passing the score clock rather than reading the current time in the middle of pure scoring logic.
- 🟣 Preserve factor labels and evidence references for the dossier ledger.
- 🟣 Add a focused unit test for boundary values and an ordinary input.
- 🟣 Bump `METHODOLOGY_VERSION` when stored assessments under the previous rules should be refreshed.
- 🟣 Update `/method`, `docs/guides/scoring-reference.md`, and the full guide.
- 🟣 Consider what happens to missing, inferred, truncated, private, or zero evidence.
- 🟣 Review whether the score can be improved by duplicate accounts, tiny events, self-merged PRs, or leaving a member blank.

## 📥 Import change checklist

- 🟠 Add small fixtures for new input formats or edge cases.
- 🟠 Keep the reader separate from normalization and extraction.
- 🟠 Preserve warnings instead of silently discarding ambiguity.
- 🟠 Validate external links against private-network destinations and redirects.
- 🟠 Keep uploads bounded by size and timeouts.
- 🟠 Do not start a ranking job before the user reviews the extraction and confirms policies.
- 🟠 Persist each completed team so a restart does not discard the whole batch.
- 🟠 Keep queue-level errors distinct from team-specific bad data.
- 🟠 Update the app handbook, import guide, and relevant tests.

## 💾 Data change checklist

- 🟡 Prefer additive schema changes.
- 🟡 Make migration code idempotent: it must be safe when an application restarts after partial progress.
- 🟡 Preserve existing JSON records or provide a deliberate conversion.
- 🟡 Ensure a migration with important data has a verified pre-migration snapshot.
- 🟡 Check foreign keys, unique keys, case behavior, and deletion semantics.
- 🟡 Keep personally identifying application inputs out of operational logs.
- 🟡 Update data-model and backup documentation.

## 🎨 Interface and accessibility checklist

- 🟢 Use the existing color variables and light/dark themes.
- 🟢 Do not use color alone to communicate status; include text or an icon with accessible labeling.
- 🟢 Use semantic headings, table headers, form labels, and navigation landmarks.
- 🟢 Check keyboard focus and small-screen behavior.
- 🟢 Keep table and code overflow contained so the page itself remains usable.
- 🟢 Prefer familiar words to implementation jargon in user-facing messages.
- 🟢 Make destructive actions clear and require the established confirmation pattern.

## 🧪 Verification choices

Choose checks that match the change and its external effects:

| Change type | Useful local checks |
|---|---|
| Pure scoring function | Relevant focused unit test, then typecheck. |
| Parser behavior | Add a representative fixture and run the parser tests. |
| Page, route, or style | Typecheck/build and inspect a local rendering at desktop and narrow widths. |
| Database migration | Use a disposable database from a prior schema and inspect both migration and recovery paths. |
| GitHub integration | Use explicit live tests only when credentials, API budget, and target accounts are understood. |
| Deployment configuration | Validate the actual deployment target and check the provider's deployment status/health after push. |
| Documentation-only | Check Markdown paths, headings, code fences, and rendered web route if it is in the Docs catalog. |

Never run live account calibration or destructive database restore against production as an ordinary local check.

## 🧹 Documentation style

- 🟦 Give every page one clear audience and purpose.
- 🟦 Start with a short promise about what the reader will learn.
- 🟦 Use descriptive headings and short paragraphs.
- 🟦 Use color emojis as scan cues, not as replacements for words.
- 🟦 Prefer a table for comparisons and an ordered list for workflows.
- 🟦 State defaults and exceptions next to the behavior they modify.
- 🟦 Call out whether a detail is user-visible, operator-only, or implementation-specific.
- 🟦 Keep commands copyable and mark destructive commands.
- 🟦 Link related docs and update the docs catalog when creating a new in-app article.
- 🟦 Remove stale claims when code behavior changes.

## 🪜 Commit and push hygiene

- 🟣 Check `git status --short` and review the exact diff.
- 🟣 Stage only the files that belong to the current change.
- 🟣 Keep commits focused and write a direct summary.
- 🟣 Confirm the configured author and authenticated GitHub account before pushing to a personal repository.
- 🟣 Never stage `.env`, database files, snapshots, credentials, or build output.
- 🟣 Confirm the remote branch receives the intended commit.
- 🟣 If the repository deploys automatically, follow the provider's deployment state and health endpoint.

## 🛤️ Future structural work

The current app is organized by the Next.js App Router, reusable components, and domain libraries. A future large restructure should preserve route conventions and import boundaries, keep database file locations stable, update Docker standalone tracing, and move code in small reviewable commits. Directory rearrangement by itself does not improve architecture; each move should make ownership or dependency direction clearer.
