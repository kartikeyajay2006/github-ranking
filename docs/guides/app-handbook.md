# 🌈 App handbook

> A practical tour through every visible part of github-ranking: what it shows, what actions it supports, and how to interpret the result.

## 🧭 The main navigation

The masthead is shared across pages. It provides stable access to the six principal areas and remains visible while the page scrolls.

| Area | Route | Purpose |
|---|---|---|
| 🔵 Individuals | `/` | Add GitHub accounts and compare their absolute assessments. |
| 🟢 Teams | `/teams` | Create and manage teams; browse their weighted standings. |
| 🟠 Upload | `/upload` | Turn a registration document into a live, ranked competition. |
| 🟣 Docs | `/docs` | Read product, contributor, and operations documentation. |
| 🟡 Method | `/method` | Read the fixed scoring rules used by the application. |
| ⚫ Theme | masthead control | Select light, dark, or automatic appearance. |

Use the wordmark to return to the individual standings. The active route is underlined so keyboard and screen-reader users have the same page context as visual users.

## 🔵 Individuals

The landing page is a public-work leaderboard for the GitHub accounts entered into this instance.

### Add accounts

- 🟦 Enter one or several GitHub usernames or profile links in the form.
- 🟦 Separators include whitespace, commas, and semicolons.
- 🟦 Duplicates are collapsed case-insensitively before analysis.
- 🟦 Invalid tokens are reported without discarding valid names in the same submission.
- 🟦 Each account is analyzed independently. Processing several accounts together is a convenience, not a shared scoring context.
- 🟦 A profile summary is reused while it is within the configured age and methodology version. A refresh action forces a new collection.

### Read the standings

- 🟩 **Rank** is the account's position among currently listed accounts. The score itself uses fixed thresholds.
- 🟩 **Score** is the weighted sum of six dimensions, rounded to one decimal place.
- 🟩 **Band** labels the score range. “Insufficient” means there is too little public evidence to rank the account confidently.
- 🟩 **Work split** compares own and team work with outside contribution over the recent activity window.
- 🟩 **Updated** indicates when the stored evidence snapshot was created.
- 🟩 **Profile** opens a dossier with the evidence and factor ledger behind the number.

Ranks can change when the set of displayed accounts changes. A person's absolute score does not move because another account was added or removed.

### Understand a profile dossier

The profile page brings the individual assessment together in a single evidence-led view.

- 🟪 The heading identifies the account, shows the assessment total and its band, and indicates the work orientation.
- 🟪 The factor ledger shows how each sub-factor contributed to the dimensions.
- 🟪 Evidence notes explain collection limits, inferred authorship, restricted contribution information, truncated histories, or other material caveats.
- 🟪 Repository cards expose the projects included in the quality portfolio and the evidence used to score them.
- 🟪 The contribution heatmap shows the public activity calendar supplied by GitHub. It is context, not the assessment by itself.
- 🟪 Team memberships link the dossier to the team views where the account appears.
- 🟪 Refresh requests new evidence and stores a new snapshot under the current methodology version.

### Fair interpretation

- 🟠 Treat the score as a consistent indicator of public evidence, not as a complete picture of a person's ability.
- 🟠 Review the factor ledger and notes before using a close score difference to make a decision.
- 🟠 A missing signal can mean the work is private, the account is new, author attribution is unavailable, or GitHub did not expose the evidence.
- 🟠 The application sees one GitHub account at a time; it cannot merge a person's work across multiple accounts automatically.

## 🟢 Teams

The Teams page combines saved team membership with member assessments. A team can be started with one account and completed later.

### Create or extend a team

1. 🟩 Give the team a stable name.
2. 🟩 Add GitHub usernames or profile links for its members.
3. 🟩 Choose lead-weighted or equal weighting. Lead-weighted is the default.
4. 🟩 Submit the form. Missing profiles are analyzed and finished profiles are reused while fresh.
5. 🟩 Open the team details to set a lead, adjust the weighting mode, or add remaining members.

Using an existing manual team's name adds new people to that team. This supports incremental entry. Bulk-imported teams belong to their import and should be managed from that import's detail page.

### Search team standings

- 🟩 Search matches team name, leader, member username, and imported participant name/GitHub label where available.
- 🟩 Several search terms can be separated by commas; a team matching any term is included.
- 🟩 A search only changes the displayed subset. The rank shown is still the overall rank in the full set.
- 🟩 Large result sets are paginated. A page is a view of the standings, not a separate ranking.
- 🟩 The full CSV action downloads the complete current standings, regardless of the current search or pagination.

### Read a team row

- 🟦 **Rank** uses competition ranking: equal scores share a rank, and the next rank skips the tied positions (for example, 1, 1, 3).
- 🟦 **Team** opens the team detail page. Its secondary text identifies weighting mode, lead, membership size, and import source when applicable.
- 🟦 **Members** shows available GitHub avatars as a compact membership preview.
- 🟦 **Score** is the team's weighted combination of finished member scores, including an imported project score where that import defines one.
- 🟦 **Band** describes the team's total using the same score bands.
- 🟦 **Dimensions** are weighted combinations of the member dimensions, so they explain what drove the team result.
- 🟦 **Updated** reflects the newest member evidence included in the team result.

### Team detail and controls

Team detail is the place to inspect composition and change membership.

- 🟣 A member's score and weight are displayed independently from the team's other members.
- 🟣 Changing team weighting changes only the team aggregation; it never rewrites a member's individual assessment.
- 🟣 Removing a member also removes that member as lead if they held that role.
- 🟣 If a member is not analyzed yet, the page identifies the pending account rather than pretending a score exists.
- 🟣 Imported members without usable accounts can retain a zero-weighted identity and source name in the import-specific result.
- 🟣 Deletion is destructive to the team record. Imported teams are removed with their import, which snapshots the database before deletion.

### Full team CSV

The **Download full ranking CSV** action returns a single spreadsheet-friendly row per current team. The columns are:

1. 🔵 Rank.
2. 🟢 Team name.
3. 🟠 Leader name.
4. 🟣 Leader GitHub username.
5. 🔵 Member names, separated with semicolons.
6. 🟢 Member GitHub usernames, separated with semicolons.
7. 🟡 Total score.

Imported member names come from the original extracted registration record. Manually managed teams do not store real names, so their GitHub handles are used as the member labels. Spreadsheet-formula-like cell values are neutralized, cells are quoted, and a UTF-8 byte-order mark helps common spreadsheet applications read non-ASCII names.

The full export uses score order and includes every team once. It is intentionally separate from the per-import CSV, which also includes project components, selected/cut-off status, failed or pending teams, and source notes.

## 🟠 Upload and competitions

The Upload area turns an application list into a draft, reviewable ranking job.

- 🟠 Upload a supported file, paste text, or supply a public link.
- 🟠 Preview team and member extraction before any ranking work starts.
- 🟠 Choose a missing-member policy, leader policy, project weight, project-missing policy, withdrawn-member policy, and optional top-N cut-off.
- 🟠 Start ranking. Results appear as teams finish, and the job survives application restarts.
- 🟠 Pause or resume a running import, retry failed work, reweight stored project results, search teams, change the cut-off, or export the import-specific CSV.
- 🟠 Review warnings for duplicate identities, shared people, ambiguous team names, and missing GitHub accounts.

See the [import handbook](imports-and-ranking.md) for supported formats, preview rules, queue states, and common extraction issues.

## 🟣 Method

The Method page is the public explanation of the factors and weights implemented in the scoring modules.

- 🟣 It identifies a methodology version.
- 🟣 It presents fixed thresholds, score dimensions, factor weights, and fairness principles.
- 🟣 It describes repository quality, build depth, peer-reviewed contributions, activity, impact, breadth, work split, teams, and import best-project scoring.
- 🟣 It documents limitations where GitHub does not provide complete or attributable evidence.

When code rules change, update this page and the methodology version in the same change. It is not a marketing page; people should be able to compare it to their evidence ledger.

## 🟡 Docs and app appearance

The Docs section provides a product handbook, a repository map, a methodology reference, and operator material. Color is used as a navigation aid, while the labels remain readable without color. Dark, light, and automatic themes share the same content and semantic structure.

- 🟡 Headings establish a scan-friendly hierarchy.
- 🟡 Colored markers distinguish doc groups and bullets.
- 🟡 Tables scroll horizontally on smaller screens.
- 🟡 Code blocks can be scrolled without stretching the page.
- 🟡 Keyboard focus remains visible, and normal document navigation works without JavaScript-specific interaction.

## 🧑‍💻 When something looks wrong

- 🔴 **Profile score seems old:** check its timestamp, then refresh if the data needs to be current.
- 🔴 **A team has no total:** inspect its members; a manual team needs at least one finished profile.
- 🔴 **An imported team appears failed:** read its per-team error and retry after resolving invalid handles or a transient service issue.
- 🔴 **The cut-off selection doesn't include a low band:** Insufficient teams are deliberately excluded from selection.
- 🔴 **A person's name is missing in a manual team's CSV:** manual team storage only has GitHub logins; import records are the name source for uploaded teams.
- 🔴 **The site asks for a password:** public instances use HTTP Basic auth when `ADMIN_PASSWORD` is configured.

For operational incidents, use the [operations handbook](operations.md). For score interpretation, use the [scoring reference](scoring-reference.md).
