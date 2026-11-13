# github-ranking

Evidence-based assessment and ranking of GitHub engineers and teams.

Every developer gets a score out of 100 from their public GitHub evidence only. The score covers the quality of their own projects, work merged into other people's repositories, consistency, reach and breadth. Teams get the weighted mean of their members' independent scores.

## Principles

- **One person, one context.** An assessment reads a single account's data and nothing else. No other participant is consulted, compared or used for normalisation.
- **Absolute thresholds.** Every curve has fixed reference points. Adding, removing or re-analysing anyone never moves another person's score; the ranking is just a sort.
- **Individual credit.** Repositories are credited by the share of commits the person actually wrote. Only pull requests reviewed and merged by someone else count as open-source contribution. Self-merged and team work counts as the person's own projects instead.
- **Hard-to-fake signals.** Counts pass through saturating log curves, so volume can't be farmed. Followers carry almost no weight, tiny PRs count less than substantial ones, and contribution-farm repos (Hacktoberfest walls and the like) count for close to nothing.
- **Traceable.** Each profile shows a score ledger. Every factor is listed with its evidence, its weight and the points it earned, and the points add up to the total.

## What it measures

| Dimension | Weight | Built from |
|---|---|---|
| Project quality | 32% | The 5 best of up to 24 owned repos plus up to 8 team/organisation repos (35/25/18/12/10), each scaled by authorship share: README, docs, tests, CI, licence, releases, authored commits, maintenance, stars, forks |
| Open-source contribution | 25% | Peer-reviewed PRs only: the author isn't a member or collaborator, and someone else merged it. Weighted by project stature and change size; distinct repos, most prominent project, acceptance rate, issues and reviews |
| Activity & consistency | 15% | Active days, active weeks, volume and recency over the last 12 months |
| Impact & reach | 18% | Stars earned, forks, repos with 10+ stars; followers only 5% of this section |
| Engineering breadth | 10% | Languages, number of substantial projects, repos contributed to this year |

Each profile also splits the last 12 months' commits and PRs into **own & team work** and **outside contribution**, and every merged PR elsewhere is labelled Outside, Team or Farm. The profile is labelled **Builder-led**, **Balanced** or **Contributor-led**. The full specification is on the `/method` page.

### Teams

- One member: 100% that member.
- **Lead-weighted** (default): the lead carries 1.2× an equal share, and the others split the rest. That gives 60/40 for two members, 40/30/30 for three and 30/23.3/23.3/23.3 for four.
- **Equal average**: every member carries 1/n.
- Members can be added whenever they're ready, either on the team page or by creating a team with the same name again. Adding someone only re-weights the team; it never changes anyone's own score.

## Running it

Requires **Node 22.13+**, because storage uses the built-in `node:sqlite` with no native dependencies.

```bash
npm install
cp .env.example .env      # set GITHUB_TOKEN, or rely on `gh auth login`
npm run dev               # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | `gh auth token` | GitHub token for API reads. A fine-grained token with no extra permissions is enough, since only public data is read. |
| `DATABASE_PATH` | `data/ranking.db` | SQLite file holding analyses, standings and teams. |
| `ANALYSIS_TTL_HOURS` | `12` | How long a stored analysis is reused before a fresh crawl. |

The database must live on persistent disk. Serverless hosts with ephemeral file systems will lose it, so use a VM, a container with a volume, or any Node host with a disk.

### Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests for scoring, team weights, parsing and signal detection (no network) |
| `npm run typecheck` | TypeScript |
| `CALIBRATE=user1,user2 npm run calibrate` | Live run against real accounts; writes scores to `calibration.txt` |

## How it works

```
src/
  lib/github/client.ts     GraphQL client: token resolution, request gate (4 in flight), secondary-limit back-off, timeouts
  lib/github/collect.ts    Evidence for ONE login: profile, 12-month contributions, repo scan, deep repo inspection, external PR search
  lib/scoring/individual.ts  Pure, deterministic scoring from that evidence
  lib/scoring/team.ts      Team weights and weighted aggregation of finished member scores
  lib/analyze.ts           Collect → score → store, with freshness cache and in-flight de-duplication
  lib/store.ts, db.ts      SQLite persistence (profiles, individuals, teams, members)
  app/                     Next.js App Router pages and server actions
```

A typical account takes 5–10 seconds to analyse. Very large repositories are inspected in batches of their own. When counting a repository's full commit history times out, that owner's last-12-month commits to it are used instead, and the profile notes the substitution.

## Known limits

- Only public data is inspected. Private contributions show in the activity calendar when the user has enabled that, but their content can't be examined.
- Team repositories are discovered through merged PRs and last-12-month commits. An old organisation project with no recent activity isn't picked up.
- Contribution farms are recognised by repository name.
- Tests are detected at the repository root and in `src/test`. Tests nested deeper in a monorepo can be missed.
- Commits made from an e-mail address that isn't linked to the account don't attribute to it. On repositories the person owns, half of the history is credited instead.
