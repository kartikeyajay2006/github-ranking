import "server-only";
import { GitHubError, graphql } from "./client";
import type { ContributionDay, ExternalPullRequest, ProfileEvidence, RepoEvidence, RepoSummary } from "../types";

const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const REPO_SCAN_PAGES = 10; // 1,000 owned repositories
const INSPECT_LIMIT = 24;
const INSPECT_BATCH = 8;

export function normaliseLogin(input: string): string | null {
  let value = input.trim();
  const url = value.match(/github\.com\/([^/?#\s]+)/i);
  if (url?.[1]) value = url[1];
  value = value.replace(/^@/, "");
  return LOGIN_RE.test(value) ? value : null;
}

/* ------------------------------------------------------------------ core ------------------------------------------------------------------ */

const CORE = /* GraphQL */ `
  query Core($login: String!, $from: DateTime!, $to: DateTime!) {
    rateLimit { remaining limit resetAt }
    user(login: $login) {
      id login name avatarUrl(size: 160) bio company location websiteUrl createdAt
      followers { totalCount }
      following { totalCount }
      forks: repositories(ownerAffiliations: OWNER, isFork: true, privacy: PUBLIC) { totalCount }
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
        commitContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner owner { login } } contributions { totalCount } }
        pullRequestContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner owner { login } } contributions { totalCount } }
        pullRequestReviewContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner owner { login } } contributions { totalCount } }
        issueContributionsByRepository(maxRepositories: 100) { repository { nameWithOwner owner { login } } contributions { totalCount } }
      }
    }
  }
`;

interface ByRepo {
  repository: { nameWithOwner: string; owner: { login: string } };
  contributions: { totalCount: number };
}

interface CoreData {
  user: null | {
    id: string;
    login: string;
    name: string | null;
    avatarUrl: string;
    bio: string | null;
    company: string | null;
    location: string | null;
    websiteUrl: string | null;
    createdAt: string;
    followers: { totalCount: number };
    following: { totalCount: number };
    forks: { totalCount: number };
    contributionsCollection: {
      restrictedContributionsCount: number;
      contributionCalendar: { totalContributions: number; weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
      commitContributionsByRepository: ByRepo[];
      pullRequestContributionsByRepository: ByRepo[];
      pullRequestReviewContributionsByRepository: ByRepo[];
      issueContributionsByRepository: ByRepo[];
    };
  };
}

/* --------------------------------------------------------------- repo scan --------------------------------------------------------------- */

const SCAN = /* GraphQL */ `
  query Scan($login: String!, $after: String) {
    user(login: $login) {
      repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100, after: $after,
                   orderBy: { field: STARGAZERS, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { nameWithOwner stargazerCount forkCount diskUsage pushedAt isArchived isEmpty description primaryLanguage { name } }
      }
    }
  }
`;

interface ScanNode {
  nameWithOwner: string;
  stargazerCount: number;
  forkCount: number;
  diskUsage: number | null;
  pushedAt: string | null;
  isArchived: boolean;
  isEmpty: boolean;
  description: string | null;
  primaryLanguage: { name: string } | null;
}

interface ScanData {
  user: null | {
    repositories: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ScanNode[] };
  };
}

/* -------------------------------------------------------------- inspection -------------------------------------------------------------- */

const REPO_FRAGMENT = /* GraphQL */ `
  fragment Inspect on Repository {
    nameWithOwner url description homepageUrl stargazerCount forkCount isArchived createdAt pushedAt diskUsage
    licenseInfo { spdxId name }
    repositoryTopics(first: 1) { totalCount }
    releases { totalCount }
    languages(first: 6, orderBy: { field: SIZE, direction: DESC }) { totalSize edges { size node { name color } } }
    root: object(expression: "HEAD:") { ... on Tree { entries { name type size } } }
    workflows: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
    srcTest: object(expression: "HEAD:src/test") { ... on Tree { entries { name } } }
  }
`;

/** Commit counting is isolated because walking history on very large repositories can time out on GitHub's side. */
const COMMITS_FRAGMENT = /* GraphQL */ `
  fragment Commits on Repository {
    defaultBranchRef {
      target {
        ... on Commit {
          all: history { totalCount }
          mine: history(author: { id: $authorId }, first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { committedDate } }
        }
      }
    }
  }
`;

interface InspectNode {
  nameWithOwner: string;
  url: string;
  description: string | null;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  createdAt: string;
  pushedAt: string | null;
  diskUsage: number | null;
  licenseInfo: { spdxId: string | null; name: string } | null;
  repositoryTopics: { totalCount: number };
  releases: { totalCount: number };
  languages: { totalSize: number; edges: { size: number; node: { name: string; color: string | null } }[] };
  root: { entries?: { name: string; type: string; size: number }[] } | null;
  workflows: { entries?: { name: string }[] } | null;
  srcTest: { entries?: { name: string }[] } | null;
}

interface CommitsNode {
  defaultBranchRef: { target: { all?: { totalCount: number }; mine?: { totalCount: number; pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes?: { committedDate: string }[] } } } | null;
}

const MORE_COMMITS = /* GraphQL */ `
  query MoreCommits($owner: String!, $name: String!, $authorId: ID!, $after: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { target { ... on Commit {
        history(author: { id: $authorId }, first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { committedDate } }
      } } }
    }
  }
`;

interface MoreCommitsData {
  repository: { defaultBranchRef: { target: { history?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { committedDate: string }[] } } } | null } | null;
}

/** Commit dates beyond the first 100 for a person's busiest projects, so heavy committers' involvement isn't truncated to their last few weeks. */
const DEEP_RHYTHM_REPOS = 3;
const DEEP_RHYTHM_PAGES = 4;

/**
 * Pages further back through each repository's history at once: one request per round fetches the next
 * 100 commits of every repository that still has more, instead of one request per repository per page.
 */
async function moreCommitDates(repos: { name: string; cursor: string }[], authorId: string): Promise<Map<string, string[]>> {
  const dates = new Map(repos.map((r) => [r.name, [] as string[]]));
  let open = repos.map((r) => ({ ...r }));
  for (let round = 0; round < DEEP_RHYTHM_PAGES && open.length; round++) {
    const query = `query MoreCommits($authorId: ID!) {\n${open
      .map((r, i) => {
        const [owner, name] = r.name.split("/");
        return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { defaultBranchRef { target { ... on Commit {
          history(author: { id: $authorId }, first: 100, after: ${JSON.stringify(r.cursor)}) { pageInfo { hasNextPage endCursor } nodes { committedDate } } } } } }`;
      })
      .join("\n")}\n}`;
    let data: Record<string, MoreCommitsData["repository"]>;
    try {
      ({ data } = await graphql<Record<string, MoreCommitsData["repository"]>>(query, { authorId }, { timeoutMs: 12_000, retries: 0 }));
    } catch (err) {
      if (err instanceof GitHubError && err.kind === "upstream") break;
      throw err;
    }
    const next: typeof open = [];
    open.forEach((r, i) => {
      const h = data[`r${i}`]?.defaultBranchRef?.target.history;
      if (!h) return;
      dates.get(r.name)!.push(...h.nodes.map((n) => n.committedDate));
      if (h.pageInfo.hasNextPage && h.pageInfo.endCursor) next.push({ name: r.name, cursor: h.pageInfo.endCursor });
    });
    open = next;
  }
  return dates;
}

/** Distinct calendar weeks and first/last dates among a person's commits (the 100 most recent). */
export function commitRhythm(dates: string[]): { weeks: number; first: string | null; last: string | null } {
  if (!dates.length) return { weeks: 0, first: null, last: null };
  const sorted = [...dates].sort();
  const weeks = new Set(sorted.map((d) => Math.floor(Date.parse(d) / (7 * 86_400_000))));
  return { weeks: weeks.size, first: sorted[0]!, last: sorted.at(-1)! };
}

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "playwright", "testing", "test-suite"]);
const TEST_FILES = [
  /^(jest|vitest|karma|playwright|cypress|mocha|ava|jasmine)\.config\./i,
  /^\.mocharc/i,
  /^(pytest\.ini|tox\.ini|noxfile\.py|conftest\.py|phpunit\.xml(\.dist)?|\.rspec)$/i,
  /_test\.go$/i,
  /\.test\.[cm]?[jt]sx?$/i,
];
const CI_ROOT = new Set([".gitlab-ci.yml", ".travis.yml", ".circleci", "azure-pipelines.yml", "jenkinsfile", ".drone.yml", "bitbucket-pipelines.yml", "buildkite"]);
const DOC_DIRS = new Set(["docs", "doc", "documentation", "website", "book", "guide"]);
const DOC_FILES = [/^mkdocs\.ya?ml$/i, /^docusaurus\.config\./i, /^book\.toml$/i, /^\.readthedocs\.ya?ml$/i];
const README_RE = /^readme(\.(md|markdown|mdx|rst|txt|adoc|org))?$/i;

export function readRepo(node: InspectNode): RepoEvidence {
  const entries = node.root?.entries ?? [];
  const names = entries.map((e) => e.name.toLowerCase());
  const readme = entries.find((e) => e.type === "blob" && README_RE.test(e.name));
  const total = node.languages.totalSize || 0;
  return {
    nameWithOwner: node.nameWithOwner,
    url: node.url,
    description: node.description?.trim() || null,
    homepage: node.homepageUrl?.trim() || null,
    stars: node.stargazerCount,
    forks: node.forkCount,
    archived: node.isArchived,
    createdAt: node.createdAt,
    pushedAt: node.pushedAt,
    diskKb: node.diskUsage ?? 0,
    license: node.licenseInfo && node.licenseInfo.spdxId !== "NOASSERTION" ? node.licenseInfo.spdxId ?? node.licenseInfo.name : node.licenseInfo ? "Custom" : null,
    topics: node.repositoryTopics.totalCount,
    releases: node.releases.totalCount,
    languages: node.languages.edges.map((e) => ({
      name: e.node.name,
      color: e.node.color,
      share: total ? e.size / total : 0,
    })),
    readmeBytes: readme?.size ?? 0,
    hasTests:
      entries.some((e) => e.type === "tree" && TEST_DIRS.has(e.name.toLowerCase())) ||
      names.some((n) => TEST_FILES.some((re) => re.test(n))) ||
      (node.srcTest?.entries?.length ?? 0) > 0,
    hasCI: (node.workflows?.entries?.length ?? 0) > 0 || names.some((n) => CI_ROOT.has(n)),
    hasDocs:
      entries.some((e) => e.type === "tree" && DOC_DIRS.has(e.name.toLowerCase())) ||
      names.some((n) => DOC_FILES.some((re) => re.test(n))),
    commitsTotal: 0,
    commitsByOwner: 0,
    commitsSource: "history",
  };
}

function aliases(names: string[], fragment: string) {
  return names
    .map((full, i) => {
      const [owner, name] = full.split("/");
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...${fragment} }`;
    })
    .join("\n");
}

/** Runs an aliased per-repository query; on timeout, halves the batch until single repositories fail on their own. */
async function perRepo<T>(
  names: string[],
  build: (names: string[]) => { query: string; variables?: Record<string, unknown> },
  timeoutMs: number,
  onGiveUp: (name: string) => void,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!names.length) return out;
  const { query, variables } = build(names);
  try {
    const { data } = await graphql<Record<string, T | null>>(query, variables, { timeoutMs, retries: names.length === 1 ? 1 : 0 });
    names.forEach((name, i) => {
      const node = data[`r${i}`];
      if (node) out.set(name, node);
    });
  } catch (err) {
    if (!(err instanceof GitHubError && err.kind === "upstream")) throw err;
    if (names.length === 1) {
      onGiveUp(names[0]!);
      return out;
    }
    const mid = Math.ceil(names.length / 2);
    const [a, b] = await Promise.all([
      perRepo<T>(names.slice(0, mid), build, timeoutMs, onGiveUp),
      perRepo<T>(names.slice(mid), build, timeoutMs, onGiveUp),
    ]);
    for (const m of [a, b]) for (const [k, v] of m) out.set(k, v);
  }
  return out;
}

/** Repositories above this size (KB) get a batch of their own so they can't stall smaller ones. */
const HEAVY_REPO_KB = 400_000;

async function inspectRepos(
  names: string[],
  sizes: Map<string, number>,
  authorId: string,
  yearCommits: Map<string, number>,
  notes: string[],
): Promise<RepoEvidence[]> {
  const heavy = names.filter((n) => (sizes.get(n) ?? 0) > HEAVY_REPO_KB);
  const light = names.filter((n) => (sizes.get(n) ?? 0) <= HEAVY_REPO_KB);
  const batches: string[][] = heavy.map((n) => [n]);
  for (let i = 0; i < light.length; i += INSPECT_BATCH) batches.push(light.slice(i, i + INSPECT_BATCH));

  const detail = new Map<string, InspectNode>();
  const commits = new Map<string, CommitsNode>();
  const commitsUnavailable: string[] = [];

  // Detail and commit counts in one request per batch. Huge repositories, and any repository whose
  // combined request times out, fall back to two separate requests (commit counting gives up sooner).
  const separately: string[] = [...heavy];
  const combinedBatches = batches.filter((b) => !(b.length === 1 && heavy.includes(b[0]!)));
  await Promise.all(
    combinedBatches.map(async (batch) => {
      const both = await perRepo<InspectNode & CommitsNode>(
        batch,
        (n) => ({ query: `query InspectAll($authorId: ID!) {\n${aliases(n, "Both")}\n}\n${REPO_FRAGMENT}\n${COMMITS_FRAGMENT}\nfragment Both on Repository { ...Inspect ...Commits }`, variables: { authorId } }),
        20_000,
        (name) => separately.push(name),
      );
      for (const [k, v] of both) {
        detail.set(k, v);
        commits.set(k, v);
      }
    }),
  );
  await Promise.all(
    separately.map((name) => [name]).map(async (batch) => {
      const [d, c] = await Promise.all([
        perRepo<InspectNode>(batch, (n) => ({ query: `query Inspect {\n${aliases(n, "Inspect")}\n}\n${REPO_FRAGMENT}` }), 20_000, (name) =>
          notes.push(`${name} could not be inspected (GitHub timed out on it).`),
        ),
        perRepo<CommitsNode>(
          batch,
          (n) => ({ query: `query Commits($authorId: ID!) {\n${aliases(n, "Commits")}\n}\n${COMMITS_FRAGMENT}`, variables: { authorId } }),
          8_000,
          (name) => commitsUnavailable.push(name),
        ),
      ]);
      for (const [k, v] of d) detail.set(k, v);
      for (const [k, v] of c) commits.set(k, v);
    }),
  );

  if (commitsUnavailable.length)
    notes.push(
      `Commit history for ${commitsUnavailable.join(", ")} is too large to count; the owner's last-12-month commits there were used instead.`,
    );

  const pending: { repo: RepoEvidence; dates: string[]; cursor: string }[] = [];
  const result = names.flatMap((name) => {
    const node = detail.get(name);
    if (!node) return [];
    const repo = readRepo(node);
    const history = commits.get(name)?.defaultBranchRef?.target;
    if (history?.all) {
      repo.commitsTotal = history.all.totalCount;
      repo.commitsByOwner = history.mine?.totalCount ?? 0;
      const dates = (history.mine?.nodes ?? []).map((n) => n.committedDate);
      const rhythm = commitRhythm(dates);
      repo.authoredWeeks = rhythm.weeks;
      repo.authoredFirst = rhythm.first;
      repo.authoredLast = rhythm.last;
      if (history.mine?.pageInfo?.hasNextPage && history.mine.pageInfo.endCursor) pending.push({ repo, dates, cursor: history.mine.pageInfo.endCursor });
    } else {
      const recent = yearCommits.get(name.toLowerCase()) ?? 0;
      repo.commitsTotal = recent;
      repo.commitsByOwner = recent;
      repo.commitsSource = "last-year";
    }
    return [repo];
  });

  // Read deeper into the history of the person's busiest projects.
  const busiest = pending.sort((a, b) => b.repo.commitsByOwner - a.repo.commitsByOwner).slice(0, DEEP_RHYTHM_REPOS);
  if (busiest.length) {
    const more = await moreCommitDates(
      busiest.map((p) => ({ name: p.repo.nameWithOwner, cursor: p.cursor })),
      authorId,
    );
    for (const p of busiest) {
      const rhythm = commitRhythm([...p.dates, ...(more.get(p.repo.nameWithOwner) ?? [])]);
      p.repo.authoredWeeks = rhythm.weeks;
      p.repo.authoredFirst = rhythm.first;
      p.repo.authoredLast = rhythm.last;
    }
  }
  return result;
}

/** Ranks scanned repositories by how likely they are to be the account's most representative work. */
export function inspectionCandidates(login: string, repos: RepoSummary[], limit = INSPECT_LIMIT): string[] {
  const now = Date.now();
  const profileRepo = `${login}/${login}`.toLowerCase();
  return repos
    .filter((r) => r.diskKb > 0 && r.nameWithOwner.toLowerCase() !== profileRepo)
    .map((r) => {
      const ageDays = r.pushedAt ? (now - Date.parse(r.pushedAt)) / 86_400_000 : 9999;
      const score =
        2 * Math.log1p(r.stars) +
        Math.log1p(r.forks) +
        (r.hasDescription ? 0.5 : 0) +
        Math.min(1.5, (1.5 * Math.log1p(r.diskKb)) / Math.log1p(20_000)) +
        (ageDays < 365 ? 1 : 0) -
        (r.archived ? 0.5 : 0);
      return { name: r.nameWithOwner, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.name);
}

/* --------------------------------------------------------------- external --------------------------------------------------------------- */

const EXTERNAL_COUNTS = /* GraphQL */ `
  query ExternalCounts($merged: String!, $closed: String!, $open: String!, $issues: String!) {
    merged: search(query: $merged, type: ISSUE, first: 1) { issueCount }
    closed: search(query: $closed, type: ISSUE, first: 1) { issueCount }
    open: search(query: $open, type: ISSUE, first: 1) { issueCount }
    issues: search(query: $issues, type: ISSUE, first: 1) { issueCount }
  }
`;

const MERGED_PULLS = /* GraphQL */ `
  query MergedPulls($q: String!, $first: Int!, $after: String) {
    search(query: $q, type: ISSUE, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          mergedAt additions deletions authorAssociation
          mergedBy { login }
          repository { nameWithOwner stargazerCount }
        }
      }
    }
  }
`;

const ISSUES = /* GraphQL */ `
  query Issues($q: String!) {
    search(query: $q, type: ISSUE, first: 100) {
      nodes { ... on Issue { authorAssociation repository { nameWithOwner } } }
    }
  }
`;

interface IssuesData {
  search: { nodes: ({ authorAssociation?: string; repository?: { nameWithOwner: string } } | null)[] };
}

interface CountsData {
  merged: { issueCount: number };
  closed: { issueCount: number };
  open: { issueCount: number };
  issues: { issueCount: number };
}

interface PullNode {
  mergedAt?: string;
  additions?: number;
  deletions?: number;
  authorAssociation?: string;
  mergedBy?: { login: string } | null;
  repository?: { nameWithOwner: string; stargazerCount: number };
}

interface PullsData {
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (PullNode | null)[] };
}

const PULL_PAGES = 5;
const PULL_PAGE_SIZE = 40;

/** Every merged pull request outside the account's own repositories, newest first, up to 200, with who merged it and the author's role. */
async function mergedPulls(login: string): Promise<ExternalPullRequest[]> {
  const q = `is:pr is:merged author:${login} -user:${login} sort:created-desc`;
  const out: ExternalPullRequest[] = [];
  let after: string | null = null;
  for (let page = 0; page < PULL_PAGES; page++) {
    let res: { data: PullsData };
    try {
      res = await graphql<PullsData>(MERGED_PULLS, { q, first: PULL_PAGE_SIZE, after });
    } catch (err) {
      if (!(err instanceof GitHubError && err.kind === "upstream")) throw err;
      res = await graphql<PullsData>(MERGED_PULLS, { q, first: PULL_PAGE_SIZE / 2, after });
    }
    for (const n of res.data.search.nodes) {
      if (!n?.repository || !n.mergedAt) continue;
      out.push({
        repo: n.repository.nameWithOwner,
        stars: n.repository.stargazerCount,
        mergedAt: n.mergedAt,
        lines: (n.additions ?? 0) + (n.deletions ?? 0),
        association: n.authorAssociation ?? "NONE",
        selfMerged: !!n.mergedBy && n.mergedBy.login.toLowerCase() === login.toLowerCase(),
      });
    }
    if (!res.data.search.pageInfo.hasNextPage) break;
    after = res.data.search.pageInfo.endCursor;
  }
  return out;
}

const EXTERNAL_ALL = /* GraphQL */ `
  query External($merged: String!, $closed: String!, $open: String!, $issues: String!) {
    merged: search(query: $merged, type: ISSUE, first: 40) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { mergedAt additions deletions authorAssociation mergedBy { login } repository { nameWithOwner stargazerCount } } }
    }
    closed: search(query: $closed, type: ISSUE, first: 1) { issueCount }
    open: search(query: $open, type: ISSUE, first: 1) { issueCount }
    issues: search(query: $issues, type: ISSUE, first: 100) {
      issueCount
      nodes { ... on Issue { authorAssociation repository { nameWithOwner } } }
    }
  }
`;

interface ExternalAllData {
  merged: { issueCount: number } & PullsData["search"];
  closed: { issueCount: number };
  open: { issueCount: number };
  issues: { issueCount: number } & IssuesData["search"];
}

function toPull(n: PullNode | null, login: string): ExternalPullRequest | null {
  if (!n?.repository || !n.mergedAt) return null;
  return {
    repo: n.repository.nameWithOwner,
    stars: n.repository.stargazerCount,
    mergedAt: n.mergedAt,
    lines: (n.additions ?? 0) + (n.deletions ?? 0),
    association: n.authorAssociation ?? "NONE",
    selfMerged: !!n.mergedBy && n.mergedBy.login.toLowerCase() === login.toLowerCase(),
  };
}

async function collectExternal(login: string): Promise<ProfileEvidence["external"]> {
  // "-user:" excludes every repository owned by the account itself.
  const scope = `author:${login} -user:${login}`;
  const mergedQuery = `is:pr is:merged ${scope} sort:created-desc`;
  // One request for the counts, the issue list and the first page of merged PRs; later pages only if needed.
  let all: ExternalAllData | null = null;
  try {
    ({ data: all } = await graphql<ExternalAllData>(EXTERNAL_ALL, {
      merged: mergedQuery,
      closed: `is:pr is:closed is:unmerged ${scope}`,
      open: `is:pr is:open archived:false ${scope}`,
      issues: `is:issue ${scope} sort:created-desc`,
    }));
  } catch (err) {
    if (!(err instanceof GitHubError && err.kind === "upstream")) throw err;
  }
  if (all) {
    const sample = all.merged.nodes.map((n) => toPull(n, login)).filter((p): p is ExternalPullRequest => !!p);
    let after = all.merged.pageInfo.hasNextPage ? all.merged.pageInfo.endCursor : null;
    for (let page = 1; page < PULL_PAGES && after; page++) {
      let res: { data: PullsData };
      try {
        res = await graphql<PullsData>(MERGED_PULLS, { q: mergedQuery, first: PULL_PAGE_SIZE, after });
      } catch (err) {
        if (!(err instanceof GitHubError && err.kind === "upstream")) throw err;
        res = await graphql<PullsData>(MERGED_PULLS, { q: mergedQuery, first: PULL_PAGE_SIZE / 2, after });
      }
      sample.push(...res.data.search.nodes.map((n) => toPull(n, login)).filter((p): p is ExternalPullRequest => !!p));
      after = res.data.search.pageInfo.hasNextPage ? res.data.search.pageInfo.endCursor : null;
    }
    return {
      merged: Math.max(all.merged.issueCount, sample.length),
      closedUnmerged: all.closed.issueCount,
      open: all.open.issueCount,
      issues: all.issues.issueCount,
      sample,
      issueSample: all.issues.nodes
        .filter((n): n is { authorAssociation: string; repository: { nameWithOwner: string } } => !!n?.repository)
        .map((n) => ({ repo: n.repository.nameWithOwner, association: n.authorAssociation ?? "NONE" })),
    };
  }
  // Fallback for very heavy accounts where the combined request times out: smaller separate requests.
  const [{ data }, sample, issues] = await Promise.all([
    graphql<CountsData>(EXTERNAL_COUNTS, {
      merged: `is:pr is:merged ${scope}`,
      closed: `is:pr is:closed is:unmerged ${scope}`,
      open: `is:pr is:open archived:false ${scope}`,
      issues: `is:issue ${scope}`,
    }),
    mergedPulls(login),
    graphql<IssuesData>(ISSUES, { q: `is:issue ${scope} sort:created-desc` }),
  ]);
  const issueSample = issues.data.search.nodes
    .filter((n): n is { authorAssociation: string; repository: { nameWithOwner: string } } => !!n?.repository)
    .map((n) => ({ repo: n.repository.nameWithOwner, association: n.authorAssociation ?? "NONE" }));
  return {
    merged: Math.max(data.merged.issueCount, sample.length),
    closedUnmerged: data.closed.issueCount,
    open: data.open.issueCount,
    issues: data.issues.issueCount,
    sample,
    issueSample,
  };
}

const INSIDER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const TEAM_REPO_LIMIT = 8;

/**
 * Organisation and teammates' repositories the person built from the inside: they're a member or
 * collaborator there, merge their own PRs there, or commit there heavily without going through
 * outside review. These are inspected as projects (credited by authorship share), not as open source.
 */
export function teamRepoCandidates(login: string, pulls: ExternalPullRequest[], yearCommits: Map<string, number>, limit = TEAM_REPO_LIMIT): string[] {
  const insider = new Map<string, number>();
  const outside = new Set<string>();
  for (const p of pulls) {
    if (INSIDER.has(p.association ?? "") || p.selfMerged) insider.set(p.repo, (insider.get(p.repo) ?? 0) + 1);
    else outside.add(p.repo.toLowerCase());
  }
  const weight = new Map<string, number>();
  for (const [repo, n] of insider) if (n >= 2) weight.set(repo, n * 5);
  for (const [repo, n] of yearCommits) {
    if (repo.split("/")[0] === login.toLowerCase() || outside.has(repo) || n < 15) continue;
    const key = [...insider.keys()].find((r) => r.toLowerCase() === repo) ?? repo;
    weight.set(key, (weight.get(key) ?? 0) + n);
  }
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([repo]) => repo);
}

/* ---------------------------------------------------------------- collect ---------------------------------------------------------------- */

async function scanRepos(login: string): Promise<{ total: number; repos: RepoSummary[]; truncated: boolean }> {
  const repos: RepoSummary[] = [];
  let after: string | null = null;
  let total = 0;
  for (let page = 0; page < REPO_SCAN_PAGES; page++) {
    const res: { data: ScanData } = await graphql<ScanData>(SCAN, { login, after });
    const conn: NonNullable<ScanData["user"]>["repositories"] | undefined = res.data.user?.repositories;
    if (!conn) break;
    total = conn.totalCount;
    for (const n of conn.nodes) {
      if (n.isEmpty) continue;
      repos.push({
        nameWithOwner: n.nameWithOwner,
        stars: n.stargazerCount,
        forks: n.forkCount,
        language: n.primaryLanguage?.name ?? null,
        diskKb: n.diskUsage ?? 0,
        pushedAt: n.pushedAt,
        hasDescription: !!n.description?.trim(),
        archived: n.isArchived,
      });
    }
    if (!conn.pageInfo.hasNextPage) return { total, repos, truncated: false };
    after = conn.pageInfo.endCursor;
  }
  return { total, repos, truncated: total > repos.length };
}

function split(list: ByRepo[], login: string) {
  let own = 0;
  let external = 0;
  for (const item of list) {
    if (item.repository.owner.login.toLowerCase() === login.toLowerCase()) own += item.contributions.totalCount;
    else external += item.contributions.totalCount;
  }
  return { own, external };
}

/**
 * Collects every piece of evidence for one account. The function takes a single login and makes no
 * reference to any other participant, which is what keeps each assessment independent.
 */
export async function collectProfile(rawLogin: string): Promise<{ evidence: ProfileEvidence; notes: string[] }> {
  const login = normaliseLogin(rawLogin);
  if (!login) throw new GitHubError(`"${rawLogin}" is not a valid GitHub username.`, "invalid");

  const to = new Date();
  const from = new Date(to.getTime() - 365 * 86_400_000);
  // The profile, the repository scan and the external-work searches don't depend on each other.
  const [{ data: core }, scan, external] = await Promise.all([
    graphql<CoreData>(CORE, { login, from: from.toISOString(), to: to.toISOString() }),
    scanRepos(login),
    collectExternal(login),
  ]);
  const user = core.user;
  if (!user) throw new GitHubError(`No GitHub user named "${login}".`, "not_found");

  const notes: string[] = [];

  const cc = user.contributionsCollection;
  const yearCommits = new Map(cc.commitContributionsByRepository.map((r) => [r.repository.nameWithOwner.toLowerCase(), r.contributions.totalCount]));
  const sizes = new Map(scan.repos.map((r) => [r.nameWithOwner, r.diskKb]));
  const owned = inspectionCandidates(user.login, scan.repos);
  const team = teamRepoCandidates(user.login, external.sample, yearCommits).filter((r) => !owned.includes(r));
  const inspected = await inspectRepos([...owned, ...team], sizes, user.id, yearCommits, notes);
  for (const repo of inspected) repo.owned = repo.nameWithOwner.split("/")[0]!.toLowerCase() === user.login.toLowerCase();

  const byRepo = new Map<string, { repo: string; owner: string; commits: number; pulls: number }>();
  const entry = (r: ByRepo) => {
    const key = r.repository.nameWithOwner.toLowerCase();
    if (!byRepo.has(key)) byRepo.set(key, { repo: r.repository.nameWithOwner, owner: r.repository.owner.login, commits: 0, pulls: 0 });
    return byRepo.get(key)!;
  };
  for (const r of cc.commitContributionsByRepository) entry(r).commits += r.contributions.totalCount;
  for (const r of cc.pullRequestContributionsByRepository) entry(r).pulls += r.contributions.totalCount;

  const calendar: ContributionDay[] = cc.contributionCalendar.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  const commits = split(cc.commitContributionsByRepository, user.login);
  const pulls = split(cc.pullRequestContributionsByRepository, user.login);
  const reviews = split(cc.pullRequestReviewContributionsByRepository, user.login);
  const issues = split(cc.issueContributionsByRepository, user.login);
  const touched = new Set(
    [
      ...cc.commitContributionsByRepository,
      ...cc.pullRequestContributionsByRepository,
      ...cc.pullRequestReviewContributionsByRepository,
      ...cc.issueContributionsByRepository,
    ].map((r) => r.repository.nameWithOwner.toLowerCase()),
  );

  return {
    notes,
    evidence: {
      login: user.login,
      name: user.name?.trim() || null,
      avatarUrl: user.avatarUrl,
      bio: user.bio?.trim() || null,
      company: user.company?.trim() || null,
      location: user.location?.trim() || null,
      websiteUrl: user.websiteUrl?.trim() || null,
      createdAt: user.createdAt,
      followers: user.followers.totalCount,
      following: user.following.totalCount,
      ownedRepoCount: scan.total,
      forkCount: user.forks.totalCount,
      repos: scan.repos,
      reposTruncated: scan.truncated,
      inspected,
      year: {
        from: from.toISOString(),
        to: to.toISOString(),
        calendar,
        totalContributions: cc.contributionCalendar.totalContributions,
        restricted: cc.restrictedContributionsCount,
        commitsOwn: commits.own,
        commitsExternal: commits.external,
        pullsOwn: pulls.own,
        pullsExternal: pulls.external,
        reviewsExternal: reviews.external,
        issuesExternal: issues.external,
        reposTouched: touched.size,
        byRepo: [...byRepo.values()],
        reviewsByRepo: cc.pullRequestReviewContributionsByRepository
          .filter((r) => r.repository.owner.login.toLowerCase() !== user.login.toLowerCase())
          .map((r) => ({ repo: r.repository.nameWithOwner, count: r.contributions.totalCount })),
      },
      external,
      fetchedAt: to.toISOString(),
    },
  };
}
