/**
 * Raw evidence collected for exactly one GitHub account.
 * Nothing in here refers to any other participant; every score is derived from this object alone.
 */
export interface RepoEvidence {
  nameWithOwner: string;
  url: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  archived: boolean;
  createdAt: string;
  pushedAt: string | null;
  diskKb: number;
  license: string | null;
  topics: number;
  releases: number;
  languages: { name: string; color: string | null; share: number }[];
  readmeBytes: number;
  hasTests: boolean;
  hasCI: boolean;
  hasDocs: boolean;
  commitsTotal: number;
  commitsByOwner: number;
  /** Distinct weeks with commits by this person, and the span they cover (from their 100 most recent commits). */
  authoredWeeks?: number;
  authoredFirst?: string | null;
  authoredLast?: string | null;
  /** False for organisation or teammates' repositories the person substantially worked on. Absent on older snapshots (= owned). */
  owned?: boolean;
  /** "history": counted on the default branch. "last-year": history too large to walk, so last-12-month commits were used. */
  commitsSource?: "history" | "last-year";
}

export interface RepoSummary {
  nameWithOwner: string;
  stars: number;
  forks: number;
  language: string | null;
  diskKb: number;
  pushedAt: string | null;
  hasDescription: boolean;
  archived: boolean;
}

export interface ExternalPullRequest {
  repo: string;
  stars: number;
  mergedAt: string;
  /** Lines added + deleted. */
  lines?: number;
  /** GitHub's author association on that repository: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE… */
  association?: string;
  /** True when the author merged their own pull request. */
  selfMerged?: boolean;
}

export type PullClass = "outside" | "team" | "farm";

export interface ContributionDay {
  date: string;
  count: number;
}

export interface ProfileEvidence {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  createdAt: string;
  followers: number;
  following: number;
  /** Public, non-fork repositories owned by the account. */
  ownedRepoCount: number;
  forkCount: number;
  /** Lightweight scan of owned repositories (up to the scan cap). */
  repos: RepoSummary[];
  reposTruncated: boolean;
  /** Deep inspection of the candidate repositories most likely to represent the account's best work. */
  inspected: RepoEvidence[];
  year: {
    from: string;
    to: string;
    calendar: ContributionDay[];
    totalContributions: number;
    restricted: number;
    commitsOwn: number;
    commitsExternal: number;
    pullsOwn: number;
    pullsExternal: number;
    reviewsExternal: number;
    issuesExternal: number;
    reposTouched: number;
    /** Commits and pull requests per repository over the window. */
    byRepo?: { repo: string; owner: string; commits: number; pulls: number }[];
    /** PR reviews per repository over the window (repositories the account doesn't own). */
    reviewsByRepo?: { repo: string; count: number }[];
  };
  external: {
    merged: number;
    closedUnmerged: number;
    open: number;
    issues: number;
    /** Merged pull requests outside owned repositories, most recent first (up to 200). */
    sample: ExternalPullRequest[];
    /** Issues filed outside owned repositories, most recent first (up to 100), with the author's role there. */
    issueSample?: { repo: string; association: string }[];
  };
  fetchedAt: string;
}

export interface Factor {
  key: string;
  label: string;
  /** Normalised 0..1 achievement on this factor. */
  value: number;
  /** Share of the dimension this factor accounts for (factors in a dimension sum to 1). */
  weight: number;
  /** Plain-language evidence, e.g. "42 merged PRs across 9 repositories". */
  evidence: string;
}

export type DimensionKey = "projects" | "depth" | "opensource" | "activity" | "impact" | "breadth";

export interface Dimension {
  key: DimensionKey;
  label: string;
  /** Share of the overall score (dimensions sum to 1). */
  weight: number;
  /** 0..100 */
  score: number;
  factors: Factor[];
}

export interface RepoAssessment {
  nameWithOwner: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  /** 0..100 */
  quality: number;
  /** Weight this repository carries in the portfolio score (0 if outside the counted set). */
  portfolioWeight: number;
  signals: {
    readme: boolean;
    license: boolean;
    ci: boolean;
    tests: boolean;
    releases: boolean;
    docs: boolean;
    maintained: boolean;
  };
  commitsByOwner: number;
  owned: boolean;
  /** Share of the default branch's commits authored by this person (null when unknown). */
  authorship: number | null;
  /** Distinct weeks with commits by this person (from their 100 most recent), when known. */
  activeWeeks: number | null;
}

export interface PullBreakdown {
  total: number;
  classified: number;
  outside: number;
  team: number;
  farm: number;
  selfMerged: number;
  repos: { repo: string; stars: number; count: number; kind: PullClass; last: string; lines: number }[];
}

export type Band = "Exceptional" | "Strong" | "Proficient" | "Developing" | "Emerging";
export type Orientation = "Builder-led" | "Balanced" | "Contributor-led" | "Insufficient activity";

export interface Assessment {
  methodology: string;
  /** 0..100, one decimal */
  total: number;
  band: Band;
  dimensions: Dimension[];
  orientation: Orientation;
  /** Last-12-month share of commits + pull requests that went to repositories the account does not own. */
  split: { own: number; external: number; externalShare: number };
  repos: RepoAssessment[];
  pulls?: PullBreakdown;
  notes: string[];
}

export interface StoredProfile {
  login: string;
  evidence: ProfileEvidence;
  assessment: Assessment;
  analyzedAt: number;
}

export type WeightingMode = "leader" | "equal";

export interface Team {
  id: string;
  name: string;
  mode: WeightingMode;
  leader: string | null;
  createdAt: number;
  members: { login: string; addedAt: number }[];
}
