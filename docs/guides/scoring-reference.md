# 🧮 Scoring reference

> A code-aligned explanation of the numeric model. The application Method page remains the public, concise specification; this document explains how the implementation composes the score.

## 🌱 Ground rules

- 🟢 **Individual first:** evidence is collected and scored for one account at a time.
- 🔵 **Absolute thresholds:** the rules use fixed constants, not a comparison curve based on the current cohort.
- 🟣 **Explainable ledger:** each dimension is composed from named factors and evidence notes.
- 🟠 **Diminishing returns:** most count signals use saturating curves, so scale helps without allowing a single count to dominate indefinitely.
- 🟡 **Bounded contribution:** values are clamped into the supported range before weighted totals are calculated.
- 🔴 **Versioned output:** assessments record the methodology identifier so cached results from older rules can be refreshed.

The principal implementation is `src/lib/scoring/individual.ts`; common curves are in `src/lib/scoring/curves.ts`; project, team, and bulk-import scoring are in their own modules under `src/lib/scoring/`.

## 🎚️ Total and dimension weights

| Dimension | Key | Weight | What the dimension represents |
|---|---|---:|---|
| 🔵 Project quality | `projects` | 30% | Quality and readiness of the person's strongest original projects. |
| 🟢 Build depth | `depth` | 25% | Authored volume, project ownership, and sustained involvement. |
| 🟠 Open-source contribution | `opensource` | 10% | Work accepted by maintainers outside the person's own team. |
| 🟣 Activity and consistency | `activity` | 15% | Recent work over a fixed twelve-month window. |
| 🟡 Impact and reach | `impact` | 12% | Evidence that other people use or follow the work. |
| 🔴 Engineering breadth | `breadth` | 8% | Range across languages, substantial projects, and collaboration. |

The weights sum to 100%. Each dimension is scored on a 0–100 scale; the total is the sum of each dimension's score multiplied by its weight, rounded to one decimal place.

### Score bands

- 🟣 **Exceptional:** 75 or above.
- 🔵 **Strong:** 60 through less than 75.
- 🟢 **Proficient:** 50 through less than 60.
- 🟡 **Developing:** 35 through less than 50.
- 🟠 **Emerging:** 12 through less than 35.
- ⚫ **Insufficient:** below 12.

The Insufficient band means evidence is too limited to support a meaningful rank. It is not a negative quality judgement. It is never selected by a top-N cut-off.

## 📈 Curves

The curve helpers are intentionally small and deterministic:

- `clamp01(x)` keeps a normalized factor within 0 and 1.
- `ramp(x, full)` gives a direct linear ramp until a target is reached.
- `logRef(x, ref)` provides diminishing returns and reaches its reference score at `ref`.
- `round1(x)` rounds a displayed/scored intermediate to one decimal place where specified.
- `daysSince(date, now)` provides fixed-clock age calculations for recency and maintenance.

Use the project's curve helpers when adding a count-based factor. A raw count should not be inserted into a 0–100 dimension because its scale would be unbounded and difficult to explain.

## 🏗️ Project quality · 30%

The account's five strongest eligible repositories are considered, in order, with portfolio weights `35%, 25%, 18%, 12%, 10%`. The repository score is assembled from four bounded groups.

| Group | Share | Inputs |
|---|---:|---|
| 📘 Documentation | 26% | README substance, repository description, topics, homepage, and a docs folder/site. |
| 🧰 Engineering hygiene | 30% | License, CI, tests, and releases. |
| 🌱 Sustained work | 20% | Authored commit history and maintenance recency. |
| 🌍 Adoption | 24% | Stars and forks with diminishing returns. |

### Repository eligibility and authorship

- 🟦 Forks and the account's profile README repository are not treated as normal original projects.
- 🟦 The strongest eligible projects have the most influence; a long tail of weak repositories does not swamp the flagship.
- 🟦 The share of default-branch commits authored by the account is estimated when evidence permits.
- 🟦 `authorshipFactor(share)` is `min(1, 0.4 + 1.2 × share)`: 50% authorship reaches full credit; zero authorship still leaves owner-controlled documentation and hygiene at 40% credit.
- 🟦 A team repository with less than the minimum authorship share can be excluded rather than treated as an original project.
- 🟦 When GitHub cannot establish the author's share, the factor may be left neutral and an assessment note explains the limitation.

### Documentation and upkeep

- 🟩 README content above a small noise floor earns points through a square-root ramp; a very short README is not treated as a complete project guide.
- 🟩 A description, topics, a homepage, and docs each represent distinct maintenance choices.
- 🟩 Tests, continuous integration, a license, and published releases provide separate engineering signals.
- 🟩 Recent pushes indicate maintenance. Archived repositories receive partial maintenance credit rather than full current-maintenance credit.
- 🟩 Stars and forks indicate adoption, but their logarithmic curves saturate to reduce popularity bias.

## 🔨 Build depth · 25%

Build depth describes personal authorship and persistence across the account's portfolio.

| Factor | Share of dimension | How to read it |
|---|---:|---|
| 🔵 Authored volume | 30% | Commits authored across credited projects, with diminishing returns. |
| 🟢 Lead-built projects | 30% | Projects where the account wrote at least half the commits and met the minimum history threshold. |
| 🟠 Sustained involvement | 25% | Distinct active weeks in the account's longest-running projects. |
| 🟣 Authorship share | 15% | Portfolio-weighted share of the strongest projects personally written. |

The collector does not read unlimited history. The assessment carries notes when commit histories are sampled or when attribution is inferred. Commit count is supporting evidence; it is not the entire build-depth model.

## 🤝 Open-source contribution · 10%

Open-source contribution rewards accepted work in repositories outside the contributor's own team. Pull requests are classified before they are scored.

- 🟢 **Outside:** a non-team contributor opened the pull request, and another maintainer merged it. This is the strongest peer-reviewed category.
- 🟡 **Team:** the repository belongs to an organisation or collaborator context, or the author merged their own pull request. It receives smaller open-source credit and may contribute as project/build work.
- 🔴 **Farm:** a repository is recognized as a low-signal contribution collection project. Its pull request is heavily discounted.

Dimension factors include accepted outside pull requests, smaller-credit team/self-merged work, distinct outside repositories, the stature of those repositories, acceptance rate, and outside issues/reviews.

### Pull request substance

- 🟣 Repository stature scales the strength of a contribution, bounded from a baseline to a ceiling around the implementation's reference threshold.
- 🟣 Change size increases credit up to its own saturation point; a one-line edit contributes less than a substantial change.
- 🟣 The number of merged pull requests is itself logarithmically scaled.
- 🟣 Acceptance rate is smoothed and discounted when the decision sample is small, avoiding a perfect ratio from one trivial pull request.
- 🟣 Only a bounded recent sample is classified in detail. When the sample is smaller than GitHub's total, the assessment notes that the unobserved history is assumed to follow the observed mix.

## 🗓️ Activity and consistency · 15%

This dimension uses a fixed twelve-month evidence window. It considers active days, active weeks, contribution volume, and recency.

- 🔵 Active days reward breadth across dates, not only total event volume.
- 🟢 Active weeks reward sustained work over the year.
- 🟠 Contribution volume uses diminishing returns.
- 🟣 Recency rewards recent activity and decreases as the latest work gets older.
- 🟡 Private contributions may appear as calendar counts when GitHub exposes them, but their content is unavailable and cannot be inspected.

The heatmap is a visual aid. A high number of green squares alone does not determine the activity dimension or the total score.

## 🌍 Impact and reach · 12%

The dimension considers stars earned, forks, widely adopted repositories, and followers. Followers have a small share by design. A large audience is context, not proof that the account built the work.

- 🔵 Stars and forks use saturating curves.
- 🟢 Repository breadth considers how many repositories reach a useful adoption threshold.
- 🟠 Followers have little weight compared with project quality or build depth.
- 🟣 An impact score should be interpreted alongside authorship, since an account may be associated with a popular project without having authored most of it.

## 🧭 Engineering breadth · 8%

Breadth is composed from distinct languages, repositories with substantial quality scores, and meaningful work in other people's repositories. It rewards range across credible work rather than repository count alone.

## 🔀 Work orientation

The account dossier shows a weighted split between own/team work and outside contribution. It labels the person Builder-led, Balanced, Contributor-led, or Insufficient activity using fixed share thresholds.

- 🟦 This label describes the shape of available work; it does not add or subtract score points.
- 🟦 Work in a teammate's repository is not automatically treated as outside contribution.
- 🟦 Private or unlinked work cannot be classified with the same detail as visible public events.

## 🧑‍🤝‍🧑 Team scoring

`teamWeights()` computes weights over members with finished individual assessments. One-member teams always have 100% weight. Equal mode assigns each ready member `1/n`. Lead-weighted mode assigns the lead `1.2/n` (capped at 100%) and divides the remainder among the other ready members.

| Team size | Lead | Each teammate |
|---:|---:|---:|
| 1 | 100% | — |
| 2 | 60% | 40% |
| 3 | 40% | 30% |
| 4 | 30% | 23.33% |
| 5 | 24% | 19% |

The team total is the weighted mean of member totals. Team dimension scores and work split are aggregated with the same member weights. Pending members are shown as pending; a team is not allowed to influence the independent score of any member.

### Imported project scoring

When a registration import supplies a best-project repository, its result can be combined with the profile score:

- 🟨 Project substance: 35%.
- 🟨 Engineering quality: 30%.
- 🟨 Completeness: 25%.
- 🟨 Recognition: 10%.
- 🟨 Authorship factor: `min(1, 0.3 + 1.4 × share)`.
- 🟨 Default blend: 70% GitHub profile plus 30% best project.

The import can change its project weight after analysis. Reweighting uses stored project and GitHub results, so it does not call GitHub again. For members without a gradable project, the selected missing-project policy determines whether the profile score stands alone or the project portion is zero.

### Missing members

- 🔴 In manual teams, a member without a saved profile is pending until analyzed or removed.
- 🔴 In imports, a member without a usable GitHub account can count as 0 by default.
- 🔴 With the “skip” policy, missing identities do not consume a member share; this is an explicit choice made for that import.
- 🔴 Missing IDs remain visible in import records so a reviewer can trace extraction and team composition.

## 🧾 Method changes

When changing a scoring rule, update all the pieces together:

1. 🟦 Implement the rule in the smallest suitable scoring module.
2. 🟦 Add or adjust focused deterministic tests for pure scoring behavior.
3. 🟦 Bump the methodology version when the interpretation of stored results changes.
4. 🟦 Update the `/method` page and this reference.
5. 🟦 Review notes and dossier output so missing or inferred evidence is explained.
6. 🟦 Calibrate with a spread of accounts only when authorized credentials and a safe calibration workflow are available.
7. 🟦 Confirm that existing snapshots become stale when their methodology no longer matches.

Avoid changing thresholds merely to move a particular account or competition. A score method should be stable, legible, and reproducible for everyone.
