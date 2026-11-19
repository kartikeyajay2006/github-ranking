# 🟠 Imports and competition ranking

> This handbook follows a registration document from upload through extraction, policy selection, background ranking, review, export, and eventual deletion.

## 🚦 Lifecycle at a glance

```text
Source document
      ↓
Read bytes / download a public link
      ↓
Extract rows and text
      ↓
Normalize teams and members
      ↓
Preview a draft import
      ↓ organiser confirms policies
Queue member analyses and project checks
      ↓
Persist each team result as it finishes
      ↓
Inspect, search, reweight, cut off, export
```

- 🟢 A draft import does not start GitHub analysis by itself.
- 🔵 Each completed team result is stored immediately; a restart does not erase the completed part of the ranking.
- 🟠 The queue resumes interrupted work when the application boots.
- 🟣 Rate limits pause the queue until it is safe to continue.
- 🔴 Deleting an import is destructive to its import teams; the database takes a pre-deletion snapshot.

## 📥 Accepted input forms

The reader checks the file contents as well as the extension where possible. Uploads are limited to 25 MB.

| Format | What is read | Preparation advice |
|---|---|---|
| 📊 `.xlsx` | Workbook sheets and cell values. | Keep the column headers in the first useful header row; avoid merged cells where possible. |
| 📄 `.docx` | Word text, tables, and link text. | Use headings or tables to separate teams and clearly mark the leader. |
| 📕 `.pdf` | Extractable text and table-like layout. | Prefer searchable PDFs. Scanned image-only PDFs may not contain extractable text. |
| 🧾 `.csv` | Delimited rows. | Use one header row and separate fields such as team, name, role, and GitHub. |
| 🧮 `.tsv` | Tab-separated rows. | Preserve tabs between columns when exporting. |
| 🌐 `.html` | Tables and readable page text. | Make the source public and keep actual data in a table. |
| 📝 `.txt`, Markdown, pasted text | Text blocks, lists, and flattened tables. | Use explicit `Team` headings, `Leader` labels, and one member per line. |
| 🧩 `.json` | Arrays/objects converted to rows or readable text. | Prefer records with stable team and member fields. |
| 🔗 Google Sheets | Public sheet exported as CSV; selected worksheet tab is respected. | Set access to “Anyone with the link can view.” |
| 🔗 Google Docs | Public document exported as HTML. | Check that sharing is public before submitting. |
| 🔗 Google Slides | Public slides exported as text. | Use clearly labeled team and member blocks. |
| 🔗 Google Drive file | Public file download. | Confirm the file itself is shared, not just the containing folder. |

Old binary `.doc` and `.xls` formats are rejected. Save them as `.docx`, `.xlsx`, or CSV first. Archives that are not supported Word/Excel containers are rejected. A Google Form response page is not a response export; use its linked response sheet.

## 🧱 Source preparation

### Recommended spreadsheet shape

Use one row per person, with a stable team name repeated for every member:

| Team name | Role | Name | GitHub username | Best project |
|---|---|---|---|---|
| Aurora | Lead | Alex Example | alex-example | `https://github.com/alex-example/service` |
| Aurora | Member | Sam Example | sam-example | `https://github.com/sam-example/client` |

The parser also handles one team per row with member slots such as `Member 1`, `Member 2`, and corresponding names/GitHub columns. Use clear headers rather than creative abbreviations.

### Recommended text shape

```text
Team: Aurora
Leader: Alex Example (@alex-example)
Member: Sam Example — GitHub: sam-example

Team: Borealis
Team lead: Bea Example (https://github.com/bea-example)
Member: Chris Example (@chris-example)
```

- 🟦 Keep one team per block.
- 🟦 Put the team name in a heading or an explicit `Team name:` label.
- 🟦 Label the leader explicitly if the first listed member should not be the lead.
- 🟦 Include GitHub usernames or public profile links, not repository URLs in the username column.
- 🟦 Use a separate best-project column for each person if project scoring will be used.
- 🟦 Preserve original row order; it is used when the “first listed member leads” policy is selected.

## 🔎 Reading and extraction

The implementation is split across `read.ts`, `extract.ts`, `ai.ts`, and the upload actions.

### Read stage

- 🟢 Uploaded bytes are size-checked before parsing.
- 🟢 Spreadsheet bytes become a grid of strings; DOCX and HTML can provide both rows and text.
- 🟢 PDFs are interpreted into text and table-like rows where layout permits.
- 🟢 Google document links are converted to an export URL before download.
- 🟢 Link downloads use bounded timeouts, manually follow a limited number of redirects, and validate every host/IP against private-network addresses.
- 🟢 Links that resolve to private, loopback, link-local, or reserved network addresses are refused to reduce server-side request forgery risk.
- 🟢 Non-public Google documents return an actionable sharing error; the importer does not log into a user's Google account.

### Extraction stage

- 🟣 Header detection recognizes meanings such as team, team name, leader/lead/captain, member, participant, name, email, GitHub, and best project.
- 🟣 Both one-person-per-row grouped tables and one-team-per-row tables are supported.
- 🟣 Team names and handles are normalized for matching without changing the original display labels unnecessarily.
- 🟣 GitHub links are parsed as account links; repository URLs are treated as potential projects rather than member identities.
- 🟣 Emails are normalized for display/export and are not used as GitHub accounts.
- 🟣 Common withdrawn/cancelled states are recognized and attached to a member.
- 🟣 Markdown pipes, HTML tables, flattened text, blank-line-separated blocks, and explicit team headings are handled by separate deterministic paths.
- 🟣 Import warnings preserve ambiguity and duplicates for human review instead of silently hiding them.

### Optional assisted extraction

AI extraction is optional and requires a server-side Anthropic credential. It is intended for free-form documents that deterministic table/text extraction cannot reliably structure.

- 🟠 Keep deterministic extraction as the default when it produces a complete preview.
- 🟠 The preview remains the organiser's opportunity to inspect names, teams, leads, and handles before ranking.
- 🟠 Do not upload information that the deployment's data-handling policy does not permit to be sent to the configured model provider.
- 🟠 A failed AI response should be corrected or re-run; it must not be treated as proof that a source record was absent.

## 🧹 Duplicate and ambiguous records

- 🟡 Repeated rows for the same person in the same team are merged where the source gives enough identifying information.
- 🟡 A person typed with the same GitHub username twice in one team is flagged.
- 🟡 A person appearing in two active teams is flagged on both teams for review.
- 🟡 Same-named teams remain separate when the import evidence shows separate leaders/registrations. Their display labels can include the lead name to make the distinction visible.
- 🟡 Re-registering the same set of people does not create another live copy after a completed re-run replaces its earlier import result.
- 🟡 Withdrawn members are excluded by default. The organizer can choose to keep them for a particular import.
- 🟡 A team with no usable GitHub accounts can be retained as a zero-score result under the “count as 0” policy or left out under the explicit skip policy.

Review the warning text rather than assuming that two rows with the same name describe the same team. Names are not reliable identifiers by themselves.

## 🧮 Policies selected before ranking

### Leader policy

- 🔵 **First listed member leads:** use a source-marked leader when detected; otherwise use the first usable GitHub member in source order.
- 🔵 **Equal average:** do not designate a lead for teams where the source has no explicit lead.
- 🔵 Explicit lead markers are retained and take precedence over fallback ordering.

### Missing GitHub policy

- 🟢 **Count as 0:** keep the member's share in the team calculation with a score of zero. This is the default and prevents the score from increasing because a weaker member has no handle.
- 🟢 **Leave them out:** omit unusable identities from the weighted member set. This is a deliberate organizer choice and can change the other members' shares.
- 🟢 A syntactically valid handle that does not exist is also treated as unusable after GitHub lookup.

### Best-project policy

- 🟣 Project weights available in the UI are GitHub-only, 70/30, 50/50, and 30/70 profile/project.
- 🟣 The project is the person's best supplied repository, not an average of every URL in the document.
- 🟣 A non-repository or inaccessible URL remains a note and is not treated as a gradable project.
- 🟣 With “missing project → GitHub only,” a person without a gradable project retains their profile score.
- 🟣 With “missing project counts as 0,” the chosen project share is zero for that person.
- 🟣 Changing the weight after ranking recalculates team totals from stored component scores; it does not repeat the GitHub crawl.

### Top-N cut-off

- 🟠 A positive integer can mark the top N ranked teams as selected.
- 🟠 The selection marker is available in the per-import CSV.
- 🟠 A team in the Insufficient band is never selected, even if its row position falls within N.
- 🟠 The cut-off can be changed after ranking. It does not alter any score.

## ⚙️ Queue states and controls

| State | Meaning | Typical action |
|---|---|---|
| 🟡 Draft | The extraction is saved and can be reviewed; analysis has not been started. | Confirm source and scoring policies, then start. |
| 🔵 Pending | The team is waiting for a worker lane or a retry time. | Usually wait; correct the underlying issue if one is reported. |
| 🟣 Running | Member profiles/projects are being analyzed. | Monitor progress; pause if needed. |
| 🟠 Paused | The organizer or a service limit paused the import. | Resume after the pause reason is resolved. |
| 🟢 Done | The import has no unfinished team work. | Review scores, warnings, and export. |
| 🔴 Failed | A team could not be ranked after handling its error. | Correct handles/data or use Retry failed. |

The worker uses three lanes and the analysis batch itself is limited to three concurrent accounts. Each finished team is written immediately. A transient network or GitHub error receives progressively longer waits (1, 2, 4, 8, and 15 minutes) and stops after six attempts. Authentication failures and rate limits defer the running queue until a retry time rather than blaming every team.

### Common recovery actions

- 🟦 **Pause:** stops claiming new teams; an in-progress team can finish its current work.
- 🟦 **Resume:** returns a paused job to the worker queue.
- 🟦 **Retry failed:** resets failed teams and starts the queue again.
- 🟦 **Reweight:** uses stored GitHub and project components to recalculate scores.
- 🟦 **Change cut-off:** updates only selection markers.
- 🟦 **Delete import:** removes its team/import records after a database snapshot; profile assessments remain reusable unless separately removed.

## 📊 Competition detail and exports

The import detail view gives one competition its own rank context and controls.

- 🟢 Search can match team, participant name, or GitHub account.
- 🟢 Rank is computed across the import's completed results, not merely the visible search subset.
- 🟢 Progress distinguishes completed teams from failed and waiting work.
- 🟢 The ranking score can blend profile and best-project scores according to the saved policy.
- 🟢 The per-import **Export CSV** includes completed ranked teams in score order (rank 1 through N) and includes non-completed teams after the ranking rows for auditability.
- 🟢 One `Team, leader & members` cell groups the team name, leader, and all member names/handles. It includes each person's blended individual score beside their name.
- 🟢 `Overall team score` is a separate column, followed by band, selected status, weighted GitHub/project totals, member emails, project links, per-member component details, status, warnings/notes, and scoring policy.
- 🟢 The all-team export on `/teams` is different: it is a concise complete standings file covering all teams in the system.

CSV cells are quoted and formula-like values are prefixed to reduce spreadsheet formula injection. The UTF-8 BOM improves compatibility with spreadsheet software that otherwise guesses the wrong encoding.

## 🧯 Troubleshooting extraction

| Symptom | Check first | Useful correction |
|---|---|---|
| No teams found | Does the file have readable text or tables? Are GitHub handles present? | Re-export as CSV/XLSX or paste a clean text list. |
| Many names but no GitHub | Are profile links in hidden sheet hyperlinks or image-only text? | Add a visible GitHub username column. |
| Team names split into many records | Is the header recognized and the team spelling identical in every row? | Normalize names in the source sheet before upload. |
| Different same-name teams merged | Are distinct leads clearly identified? | Mark the lead for each registration and re-preview. |
| PDF table columns scrambled | Is the PDF text selectable and the table layout regular? | Prefer the original spreadsheet or Word document. |
| Google link denied | Is sharing set to public link viewing? | Change sharing or download and upload the file. |
| Project column ignored | Does the value point directly to a GitHub repository? | Use a canonical `github.com/owner/repository` link. |
| Import says over limit | Did it extract more than the maximum teams for one import? | Split a large event into separate documents/imports. |
| No GitHub token or rate-limit wait | Is `GITHUB_TOKEN` set and is its hourly limit available? | Configure a valid public-data token and wait for the documented reset. |

## 🔐 Data and privacy notes

- 🟥 Uploaded names, emails, project URLs, source text, and extraction warnings are stored in the local application database as part of the import.
- 🟥 The instance owner is responsible for choosing appropriate retention and access controls.
- 🟥 Public deployment should use `ADMIN_PASSWORD`; a shared password provides access control but not individual organiser accounts.
- 🟥 Public GitHub evidence is read using the configured token. The token is held server-side and must never be sent to the browser.
- 🟥 When optional AI extraction is enabled, the document text is sent to the configured provider for extraction.
- 🟥 Deleting an import removes import records and imported teams; the pre-delete backup makes recovery possible but is not a privacy-erasure mechanism.

