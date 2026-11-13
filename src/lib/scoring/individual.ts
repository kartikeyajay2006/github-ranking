import type {
  Assessment,
  Band,
  Dimension,
  DimensionKey,
  Factor,
  ExternalPullRequest,
  Orientation,
  ProfileEvidence,
  PullBreakdown,
  PullClass,
  RepoAssessment,
  RepoEvidence,
} from "../types";
import { DAY, clamp01, daysSince, logRef, plural, ramp, round1 } from "./curves";

export const METHODOLOGY_VERSION = "2026.11-r3";

/**
 * Every threshold below is a fixed constant. Nothing is normalised against a cohort, so an
 * assessment depends only on the evidence of the person being assessed: adding, removing or
 * re-analysing anyone else can never move their score.
 */
export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  projects: 0.32,
  opensource: 0.25,
  activity: 0.15,
  impact: 0.18,
  breadth: 0.1,
};

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  projects: "Project quality",
  opensource: "Open-source contribution",
  activity: "Activity & consistency",
  impact: "Impact & reach",
  breadth: "Engineering breadth",
};

/** Weights applied to an account's best repositories, best first. Depth matters, but the flagship matters most. */
export const PORTFOLIO_WEIGHTS = [0.35, 0.25, 0.18, 0.12, 0.1] as const;

export function bandFor(score: number): Band {
  if (score >= 80) return "Exceptional";
  if (score >= 65) return "Strong";
  if (score >= 50) return "Proficient";
  if (score >= 35) return "Developing";
  return "Emerging";
}

/* ------------------------------------------------------------ repository quality ------------------------------------------------------------ */

interface RepoGroups {
  documentation: number; // max 0.26
  hygiene: number; // max 0.30
  sustained: number; // max 0.20
  adoption: number; // max 0.24
}

export const REPO_GROUP_MAX: RepoGroups = { documentation: 0.26, hygiene: 0.3, sustained: 0.2, adoption: 0.24 };

const isOwned = (repo: RepoEvidence) => repo.owned !== false;

export function ownerCommits(repo: RepoEvidence): { count: number; inferred: boolean } {
  if (repo.commitsByOwner > 0 || repo.commitsSource === "last-year" || !isOwned(repo)) return { count: repo.commitsByOwner, inferred: false };
  // Commits authored under an e-mail that isn't linked to the account don't attribute. On a repository
  // the account owns, credit half of the history rather than none.
  return { count: Math.round(repo.commitsTotal * 0.5), inferred: repo.commitsTotal > 0 };
}

export function repoGroups(repo: RepoEvidence, now: number): RepoGroups {
  const readme = repo.readmeBytes > 300 ? Math.sqrt(Math.min(1, (repo.readmeBytes - 300) / 3700)) : 0;
  const age = daysSince(repo.pushedAt, now);
  const maintained = repo.archived ? 0.5 : age <= 180 ? 1 : age <= 365 ? 0.5 : 0;
  return {
    documentation:
      0.14 * readme +
      (repo.description ? 0.04 : 0) +
      (repo.topics > 0 ? 0.02 : 0) +
      (repo.homepage ? 0.03 : 0) +
      (repo.hasDocs ? 0.03 : 0),
    hygiene: (repo.license ? 0.07 : 0) + (repo.hasCI ? 0.09 : 0) + (repo.hasTests ? 0.1 : 0) + (repo.releases > 0 ? 0.04 : 0),
    sustained: 0.14 * logRef(ownerCommits(repo).count, 200) + 0.06 * maintained,
    adoption: 0.18 * logRef(repo.stars, 1000) + 0.06 * logRef(repo.forks, 150),
  };
}

const sumGroups = (g: RepoGroups) => g.documentation + g.hygiene + g.sustained + g.adoption;

/** Share of the default branch this person wrote, or null when it can't be known (unlinked e-mail, history too large). */
export function authorship(repo: RepoEvidence): number | null {
  if (repo.commitsSource === "last-year" || repo.commitsTotal <= 0) return isOwned(repo) ? null : 0.5;
  if (repo.commitsByOwner === 0 && isOwned(repo)) return null;
  return Math.min(1, repo.commitsByOwner / repo.commitsTotal);
}

/**
 * Credit a repository by how much of it the person actually wrote: half or more earns full credit,
 * a quarter earns 70%, and nothing written earns 40% (documentation and hygiene still reflect choices
 * an owner makes). Repositories they don't own and barely touched are excluded altogether.
 */
export const authorshipFactor = (share: number | null) => (share === null ? 1 : Math.min(1, 0.4 + 1.2 * share));
export const MIN_TEAM_AUTHORSHIP = 0.1;

function scaleGroups(g: RepoGroups, f: number): RepoGroups {
  return { documentation: g.documentation * f, hygiene: g.hygiene * f, sustained: g.sustained * f, adoption: g.adoption * f };
}

/* --------------------------------------------------------------- dimensions --------------------------------------------------------------- */

function dimension(key: DimensionKey, factors: Factor[]): Dimension {
  const score = factors.reduce((s, f) => s + clamp01(f.value) * f.weight, 0) * 100;
  return { key, label: DIMENSION_LABELS[key], weight: DIMENSION_WEIGHTS[key], score: round1(score), factors };
}

function projects(ev: ProfileEvidence, now: number) {
  const profileRepo = `${ev.login}/${ev.login}`.toLowerCase();
  const scored = ev.inspected
    .filter((r) => r.nameWithOwner.toLowerCase() !== profileRepo)
    .filter((r) => isOwned(r) || (authorship(r) ?? 0) >= MIN_TEAM_AUTHORSHIP)
    .map((r) => ({ repo: r, share: authorship(r), groups: scaleGroups(repoGroups(r, now), authorshipFactor(authorship(r))) }))
    .sort((a, b) => sumGroups(b.groups) - sumGroups(a.groups));

  const counted = scored.slice(0, PORTFOLIO_WEIGHTS.length);
  const agg: RepoGroups = { documentation: 0, hygiene: 0, sustained: 0, adoption: 0 };
  counted.forEach(({ groups }, i) => {
    const w = PORTFOLIO_WEIGHTS[i] ?? 0;
    agg.documentation += w * groups.documentation;
    agg.hygiene += w * groups.hygiene;
    agg.sustained += w * groups.sustained;
    agg.adoption += w * groups.adoption;
  });

  const top = counted.map((c) => c.repo);
  const count = (pred: (r: RepoEvidence) => boolean) => top.filter(pred).length;
  const of = top.length ? ` of top ${top.length}` : "";
  const commits = top.reduce((s, r) => s + ownerCommits(r).count, 0);
  const teamRepos = counted.filter((c) => !isOwned(c.repo));
  const shared = counted.filter((c) => c.share !== null && c.share < 0.5);

  const factors: Factor[] = [
    {
      key: "documentation",
      label: "Documentation",
      value: agg.documentation / REPO_GROUP_MAX.documentation,
      weight: REPO_GROUP_MAX.documentation,
      evidence: top.length
        ? `${count((r) => r.readmeBytes > 1500)}${of} with a substantial README; ${count((r) => !!r.description)} described; ${count((r) => r.hasDocs || !!r.homepage)} with docs or a homepage`
        : "No inspectable repositories",
    },
    {
      key: "hygiene",
      label: "Engineering hygiene",
      value: agg.hygiene / REPO_GROUP_MAX.hygiene,
      weight: REPO_GROUP_MAX.hygiene,
      evidence: top.length
        ? `Tests in ${count((r) => r.hasTests)}, CI in ${count((r) => r.hasCI)}, licence in ${count((r) => !!r.license)}, releases in ${count((r) => r.releases > 0)}${of}`
        : "—",
    },
    {
      key: "sustained",
      label: "Sustained development",
      value: agg.sustained / REPO_GROUP_MAX.sustained,
      weight: REPO_GROUP_MAX.sustained,
      evidence: top.length
        ? `${plural(commits, "commit")} authored; ${count((r) => daysSince(r.pushedAt, now) <= 180)}${of} pushed in the last six months` +
          (shared.length ? `; ${shared.length} credited by authorship share` : "") +
          (teamRepos.length ? `; ${plural(teamRepos.length, "team repository", "team repositories")} counted` : "")
        : "—",
    },
    {
      key: "adoption",
      label: "Adoption",
      value: agg.adoption / REPO_GROUP_MAX.adoption,
      weight: REPO_GROUP_MAX.adoption,
      evidence: top.length
        ? `${plural(top.reduce((s, r) => s + r.stars, 0), "star")} and ${plural(top.reduce((s, r) => s + r.forks, 0), "fork")} across the counted repositories`
        : "—",
    },
  ];

  const repos: RepoAssessment[] = scored.map(({ repo, groups, share }, i) => ({
    nameWithOwner: repo.nameWithOwner,
    url: repo.url,
    description: repo.description,
    language: repo.languages[0]?.name ?? null,
    stars: repo.stars,
    forks: repo.forks,
    quality: round1(sumGroups(groups) * 100),
    portfolioWeight: PORTFOLIO_WEIGHTS[i] ?? 0,
    signals: {
      readme: repo.readmeBytes > 1500,
      license: !!repo.license,
      ci: repo.hasCI,
      tests: repo.hasTests,
      releases: repo.releases > 0,
      docs: repo.hasDocs || !!repo.homepage,
      maintained: daysSince(repo.pushedAt, now) <= 180,
    },
    commitsByOwner: ownerCommits(repo).count,
    owned: isOwned(repo),
    authorship: share,
  }));

  return { dim: dimension("projects", factors), repos, inferred: top.some((r) => ownerCommits(r).inferred) };
}

/** Stature of the target project: 0.4 for an unknown repository up to 1.0 at 2,000+ stars. */
export const prWeight = (stars: number) => 0.4 + 0.6 * logRef(stars, 2000);

/** Substance of the change: a one-line fix counts 0.35, 150+ changed lines count fully. */
export const prSubstance = (lines: number | undefined) => (lines === undefined ? 1 : 0.35 + 0.65 * logRef(lines, 150));

/** Repositories that exist to collect easy pull requests (Hacktoberfest walls, "add your name", question dumps). */
export const FARM_RE =
  /(hacktober|first[-_ ]?contributions?|contributions?[-_ ]?(wall|list|board|hub)|code[-_ ]?contributions?|open[-_ ]?source[-_ ]?contributions?|add[-_ ]?your[-_ ]?(name|profile)|contributors?[-_ ]?(list|wall)|good[-_ ]?first[-_ ]?issues?|leetcode|interview[-_ ]?questions|dsa[-_ ]?(questions|problems))/i;

const INSIDER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Only peer-reviewed outside work counts as open-source contribution: the author is not an owner,
 * member or collaborator of the repository, and somebody else merged it. Everything else is the
 * person's own or team work and is assessed under projects instead.
 */
export function classifyPull(p: ExternalPullRequest): PullClass {
  if (INSIDER.has(p.association ?? "") || p.selfMerged) return "team";
  if (FARM_RE.test(p.repo.split("/")[1] ?? "")) return "farm";
  return "outside";
}

export function pullBreakdown(ev: ProfileEvidence): PullBreakdown {
  const groups = new Map<string, PullBreakdown["repos"][number]>();
  let outside = 0;
  let team = 0;
  let farm = 0;
  for (const p of ev.external.sample) {
    const kind = classifyPull(p);
    if (kind === "outside") outside++;
    else if (kind === "team") team++;
    else farm++;
    const g = groups.get(p.repo) ?? { repo: p.repo, stars: p.stars, count: 0, kind, last: p.mergedAt, lines: 0 };
    g.count++;
    g.lines += p.lines ?? 0;
    if (p.mergedAt > g.last) g.last = p.mergedAt;
    if (kind === "team") g.kind = "team";
    groups.set(p.repo, g);
  }
  const order: Record<PullClass, number> = { outside: 0, farm: 1, team: 2 };
  return {
    total: ev.external.merged,
    classified: ev.external.sample.length,
    outside,
    team,
    farm,
    selfMerged: ev.external.sample.filter((p) => p.selfMerged).length,
    repos: [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.stars - a.stars || b.count - a.count),
  };
}

function opensource(ev: ProfileEvidence, pulls: PullBreakdown) {
  const { merged, closedUnmerged, issues, sample } = ev.external;
  const outsidePulls = sample.filter((p) => classifyPull(p) !== "team");
  // Beyond the 200 most recent, assume the same mix of outside work.
  const scale = sample.length ? Math.max(1, merged / sample.length) : 0;
  const weighted =
    scale *
    outsidePulls.reduce((s, p) => s + prWeight(p.stars) * prSubstance(p.lines) * (classifyPull(p) === "farm" ? 0.15 : 1), 0);
  const outsideMerged = Math.round(pulls.outside * scale);

  const real = new Map<string, number>();
  for (const p of outsidePulls) if (classifyPull(p) === "outside") real.set(p.repo, p.stars);
  const notable = [...real.entries()].sort((a, b) => b[1] - a[1])[0];

  // Closed-unmerged PRs can't be classified; attribute them in proportion to the outside share.
  const outsideShare = sample.length ? outsidePulls.length / sample.length : 0;
  const closedOutside = closedUnmerged * outsideShare;
  const decided = outsidePulls.length * scale + closedOutside;
  const acceptance = decided ? ((outsidePulls.length * scale + 1) / (decided + 2)) * Math.min(1, decided / 10) : 0;
  // Issues and reviews count only outside the person's own and team repositories.
  const team = teamRepos(ev);
  const issueSample = ev.external.issueSample;
  const outsideIssues = issueSample
    ? Math.round((issueSample.filter((i) => !team.has(i.repo.toLowerCase())).length / Math.max(1, issueSample.length)) * issues)
    : issues;
  const outsideReviews = ev.year.reviewsByRepo
    ? ev.year.reviewsByRepo.filter((r) => !team.has(r.repo.toLowerCase())).reduce((s, r) => s + r.count, 0)
    : ev.year.reviewsExternal;
  const engagement = outsideIssues + outsideReviews;

  const excluded = pulls.team + pulls.farm;
  const factors: Factor[] = [
    {
      key: "merged",
      label: "Peer-reviewed PRs",
      value: logRef(weighted, 40),
      weight: 0.45,
      evidence: outsideMerged
        ? `${plural(outsideMerged, "PR")} merged by other maintainers (weighted ${weighted.toFixed(1)} for project stature and size)` +
          (excluded ? `; ${excluded} team, self-merged or farm PRs not counted here` : "")
        : merged
          ? `None of ${plural(merged, "merged PR")} were reviewed and merged by outside maintainers`
          : "No merged pull requests outside own repositories",
    },
    {
      key: "reach",
      label: "Repository reach",
      value: logRef(real.size, 15),
      weight: 0.2,
      evidence: real.size ? `${plural(real.size, "outside repository", "outside repositories")} accepted their work` : "—",
    },
    {
      key: "notable",
      label: "Project stature",
      value: notable ? logRef(notable[1], 20_000) : 0,
      weight: 0.1,
      evidence: notable ? `Most prominent: ${notable[0]} (${plural(notable[1], "star")})` : "—",
    },
    {
      key: "acceptance",
      label: "Acceptance rate",
      value: acceptance,
      weight: 0.1,
      evidence: decided >= 1 ? `≈${Math.round(((outsidePulls.length * scale) / decided) * 100)}% of outside PRs merged${decided < 10 ? " (small sample, discounted)" : ""}` : "No outside PRs decided",
    },
    {
      key: "engagement",
      label: "Issues & reviews",
      value: logRef(engagement, 60),
      weight: 0.15,
      evidence:
        `${plural(outsideIssues, "issue")} filed in outside projects; ${plural(outsideReviews, "review")} on outside PRs this year` +
        (issues - outsideIssues + ev.year.reviewsExternal - outsideReviews > 0
          ? ` (${issues - outsideIssues + ev.year.reviewsExternal - outsideReviews} in own or team repositories not counted)`
          : ""),
    },
  ];
  return dimension("opensource", factors);
}

function activity(ev: ProfileEvidence, now: number) {
  const from = Date.parse(ev.year.from);
  const days = ev.year.calendar.filter((d) => Date.parse(d.date) >= from - DAY / 2);
  const active = days.filter((d) => d.count > 0);
  const weeks = new Set(active.map((d) => Math.floor((Date.parse(d.date) - from) / (7 * DAY))));
  const activeWeeks = Math.min(52, weeks.size);
  let streak = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  const last = active.at(-1)?.date ?? null;
  const idle = daysSince(last, now);
  const recency = idle <= 14 ? 1 : idle >= 180 ? 0 : 1 - (idle - 14) / 166;

  const factors: Factor[] = [
    {
      key: "days",
      label: "Active days",
      value: ramp(active.length, 220),
      weight: 0.35,
      evidence: `${active.length} of ${days.length} days with contributions; longest run ${plural(streak, "day")}`,
    },
    {
      key: "weeks",
      label: "Weekly consistency",
      value: activeWeeks / 52,
      weight: 0.3,
      evidence: `Active in ${activeWeeks} of 52 weeks`,
    },
    {
      key: "volume",
      label: "Volume",
      value: logRef(ev.year.totalContributions, 1500),
      weight: 0.2,
      evidence: `${plural(ev.year.totalContributions, "contribution")} in the last 12 months`,
    },
    {
      key: "recency",
      label: "Recency",
      value: recency,
      weight: 0.15,
      evidence: last ? (idle < 1 ? "Active today" : `Last active ${plural(Math.floor(idle), "day")} ago`) : "No activity in the last 12 months",
    },
  ];
  return dimension("activity", factors);
}

function impact(ev: ProfileEvidence) {
  const stars = ev.repos.reduce((s, r) => s + r.stars, 0);
  const forks = ev.repos.reduce((s, r) => s + r.forks, 0);
  const adopted = ev.repos.filter((r) => r.stars >= 10).length;
  const factors: Factor[] = [
    { key: "stars", label: "Stars earned", value: logRef(stars, 5000), weight: 0.55, evidence: `${plural(stars, "star")} across ${plural(ev.ownedRepoCount, "original repository", "original repositories")}` },
    { key: "forks", label: "Forks of own work", value: logRef(forks, 500), weight: 0.2, evidence: plural(forks, "fork") },
    { key: "adopted", label: "Adopted projects", value: logRef(adopted, 10), weight: 0.2, evidence: `${plural(adopted, "repository", "repositories")} with 10+ stars` },
    // Follower counts are easily traded (follow-for-follow) and say little about the person's work.
    { key: "followers", label: "Followers", value: logRef(ev.followers, 1000), weight: 0.05, evidence: `${plural(ev.followers, "follower")} (deliberately minor)` },
  ];
  return dimension("impact", factors);
}

function breadth(ev: ProfileEvidence, repos: RepoAssessment[]) {
  const languages = new Set(ev.repos.filter((r) => r.language && (r.diskKb >= 100 || r.stars >= 1)).map((r) => r.language!));
  const substantial = repos.filter((r) => r.quality >= 45).length;
  const factors: Factor[] = [
    {
      key: "languages",
      label: "Languages",
      value: ramp(languages.size, 8),
      weight: 0.4,
      evidence: languages.size ? [...languages].slice(0, 8).join(", ") + (languages.size > 8 ? ` +${languages.size - 8}` : "") : "No primary languages detected",
    },
    { key: "substantial", label: "Substantial projects", value: ramp(substantial, 8), weight: 0.35, evidence: `${plural(substantial, "repository", "repositories")} scoring 45+ on quality` },
    { key: "surface", label: "Collaboration surface", value: ramp(ev.year.reposTouched, 25), weight: 0.25, evidence: `Contributed to ${plural(ev.year.reposTouched, "repository", "repositories")} this year` },
  ];
  return dimension("breadth", factors);
}

/**
 * Last-12-month commits + PRs, split into the person's own and team work versus outside contribution.
 * Repositories count as team work when they own them, are an insider there (member, collaborator,
 * self-merging), or wrote a substantial share of the code.
 */
/** Repositories (lower-case) where the person works from the inside: insider or self-merged PRs, insider issues, or a quarter of the code. */
export function teamRepos(ev: ProfileEvidence): Set<string> {
  const team = new Set<string>();
  for (const p of ev.external.sample) if (classifyPull(p) === "team") team.add(p.repo.toLowerCase());
  for (const i of ev.external.issueSample ?? []) if (INSIDER.has(i.association)) team.add(i.repo.toLowerCase());
  for (const r of ev.inspected) if (r.owned === false && (authorship(r) ?? 0) >= 0.25) team.add(r.nameWithOwner.toLowerCase());
  return team;
}

export function workSplit(ev: ProfileEvidence): { own: number; external: number } {
  if (!ev.year.byRepo) return { own: ev.year.commitsOwn + ev.year.pullsOwn, external: ev.year.commitsExternal + ev.year.pullsExternal };
  const login = ev.login.toLowerCase();
  const team = teamRepos(ev);
  let own = 0;
  let external = 0;
  for (const r of ev.year.byRepo) {
    const n = r.commits + r.pulls;
    if (r.owner.toLowerCase() === login || team.has(r.repo.toLowerCase())) own += n;
    else external += n;
  }
  return { own, external };
}

export function orientationFor(own: number, external: number): Orientation {
  if (own + external < 10) return "Insufficient activity";
  const share = external / (own + external);
  if (share >= 0.6) return "Contributor-led";
  if (share <= 0.25) return "Builder-led";
  return "Balanced";
}

/** Assesses one account from its own evidence. Pure and deterministic for a given `now`. */
export function assess(ev: ProfileEvidence, now = Date.parse(ev.fetchedAt), collectionNotes: string[] = []): Assessment {
  const proj = projects(ev, now);
  const pulls = pullBreakdown(ev);
  const dims = [proj.dim, opensource(ev, pulls), activity(ev, now), impact(ev), breadth(ev, proj.repos)];
  const total = round1(dims.reduce((s, d) => s + d.score * d.weight, 0));

  const { own, external } = workSplit(ev);

  const notes = [...collectionNotes];
  if (ev.year.restricted > 0)
    notes.push(`${plural(ev.year.restricted, "private contribution")} appear in the activity calendar; their content can't be inspected.`);
  if (ev.reposTruncated) notes.push(`Only the ${ev.repos.length.toLocaleString("en-US")} most-starred of ${ev.ownedRepoCount.toLocaleString("en-US")} repositories were scanned for impact.`);
  if (ev.external.merged > ev.external.sample.length)
    notes.push(`The ${ev.external.sample.length} most recent of ${ev.external.merged.toLocaleString("en-US")} merged PRs were classified; the rest are assumed to follow the same mix.`);
  if (pulls.team > 0)
    notes.push(`${plural(pulls.team, "merged PR")} in other accounts' repositories were team work (member, collaborator or self-merged) and count towards projects, not open source.`);
  if (pulls.farm > 0) notes.push(`${plural(pulls.farm, "PR")} went to contribution-farm repositories and count for very little.`);
  if (proj.inferred) notes.push("Some commits aren't linked to the account's e-mail; half of those repositories' history was credited to the owner.");
  if (daysSince(ev.createdAt, now) < 180) notes.push("The account is under six months old.");
  if (ev.ownedRepoCount === 0) notes.push("The account owns no public original repositories.");

  return {
    methodology: METHODOLOGY_VERSION,
    total,
    band: bandFor(total),
    dimensions: dims,
    orientation: orientationFor(own, external),
    split: { own, external, externalShare: own + external ? external / (own + external) : 0 },
    repos: proj.repos,
    pulls,
    notes,
  };
}
