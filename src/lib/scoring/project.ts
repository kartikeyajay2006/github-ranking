import type { Band, RepoEvidence } from "../types";
import { bandFor } from "./individual";
import { clamp01, daysSince, logRef, plural, ramp, round1 } from "./curves";

/**
 * Best-project grade: one repository the applicant named as the best thing they have built, scored 0–100
 * on its own evidence and on how much of it they wrote. Deterministic and absolute, like the profile score.
 */

export const PROJECT_METHODOLOGY = "2026.11-p1";

/** The repository plus what the profile collector doesn't keep for every repo. */
export interface ProjectEvidence extends RepoEvidence {
  /** Bytes of code GitHub detected across languages. */
  codeBytes: number;
  isFork: boolean;
  parent: string | null;
  /** The applicant's GitHub login (commitsByOwner counts their commits). */
  person: string;
  fetchedAt: string;
}

export type ProjectRef = { owner: string; name: string };
export type ProjectProblem = "missing" | "not_repo" | "not_found";

const OWNER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const NOT_OWNERS = new Set(["orgs", "settings", "topics", "features", "marketplace", "explore", "sponsors", "login", "about", "search", "apps", "collections", "trending", "notifications"]);

/** A GitHub repository from a best-project link: github.com/owner/repo[/…] or owner.github.io/repo. */
export function parseProjectRef(link: string | null | undefined): ProjectRef | { problem: ProjectProblem } {
  if (!link?.trim()) return { problem: "missing" };
  const gh = link.match(/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})/i);
  if (gh) {
    const owner = gh[1]!;
    const name = gh[2]!.replace(/\.git$/i, "");
    if (!OWNER_RE.test(owner) || NOT_OWNERS.has(owner.toLowerCase()) || !name || name === "." || name === "..") return { problem: "not_repo" };
    return { owner, name };
  }
  const pages = link.match(/([A-Za-z0-9-]{1,39})\.github\.io(?:\/([A-Za-z0-9_.-]{1,100}))?/i);
  if (pages && OWNER_RE.test(pages[1]!)) return { owner: pages[1]!, name: pages[2] || `${pages[1]}.github.io` };
  return { problem: "not_repo" };
}

export interface ProjectPart {
  key: "substance" | "engineering" | "completeness" | "recognition";
  label: string;
  weight: number;
  value: number;
  evidence: string;
}

export interface ProjectAssessment {
  methodology: string;
  repo: string;
  url: string;
  description: string | null;
  language: string | null;
  score: number;
  band: Band;
  /** Quality of the project itself, 0–100, before the authorship factor. */
  quality: number;
  /** Share of the default branch the applicant wrote (null: unknown, their commits aren't linked to the account). */
  share: number | null;
  authorshipFactor: number;
  owned: boolean;
  fork: boolean;
  parts: ProjectPart[];
  notes: string[];
}

export const PROJECT_WEIGHTS = { substance: 0.35, engineering: 0.3, completeness: 0.25, recognition: 0.1 } as const;

/** Share assumed when the applicant owns the repo but GitHub can't attribute their commits (unlinked e-mail). */
const UNKNOWN_OWNED_SHARE = 0.6;

/**
 * How much of the grade the applicant keeps: half or more of the code earns full credit, a quarter 65%,
 * none 30% (choosing and presenting a project still says something). Forks are measured the same way, so a
 * fork with no new work scores low.
 */
export const projectAuthorshipFactor = (share: number) => Math.min(1, 0.3 + 1.4 * share);

export function assessProject(ev: ProjectEvidence, now = Date.parse(ev.fetchedAt)): ProjectAssessment {
  const owned = ev.nameWithOwner.split("/")[0]!.toLowerCase() === ev.person.toLowerCase();
  const notes: string[] = [];

  let share: number | null;
  if (ev.commitsSource === "last-year" || ev.commitsTotal <= 0) share = owned && !ev.isFork ? null : ev.commitsByOwner > 0 ? 0.5 : 0;
  else if (ev.commitsByOwner === 0) share = owned && !ev.isFork ? null : 0;
  else share = Math.min(1, ev.commitsByOwner / ev.commitsTotal);
  const effective = share ?? UNKNOWN_OWNED_SHARE;
  const factor = projectAuthorshipFactor(effective);
  if (share === null) notes.push("GitHub can't attribute the commits to this account (likely an unlinked e-mail); a 60% share is assumed for a repository they own.");
  if (ev.isFork) notes.push(`A fork${ev.parent ? ` of ${ev.parent}` : ""}: only the applicant's own commits earn authorship.`);
  if (!owned && share === 0) notes.push(`@${ev.person} has no commits on the default branch of ${ev.nameWithOwner}.`);

  const weeks = ev.authoredWeeks ?? Math.min(12, Math.round(ev.commitsByOwner / 4));
  const readme = ev.readmeBytes > 300 ? Math.sqrt(Math.min(1, (ev.readmeBytes - 300) / 4700)) : 0;
  const recent = daysSince(ev.pushedAt, now) <= 180;
  const demo = !!ev.homepage;

  // Code and tooling that arrived in one or two commits (an upload, a template, a generated app) is weaker
  // evidence of building than the same code grown over a history: full credit from about 25 commits.
  const history = 0.5 + 0.5 * logRef(ev.commitsTotal, 25);
  if (ev.commitsTotal > 0 && history < 0.8) notes.push(`Only ${plural(ev.commitsTotal, "commit")} of history, so code volume and tooling count for ${Math.round(history * 100)}%.`);
  const substance = 0.4 * logRef(ev.codeBytes, 250_000) * history + 0.3 * logRef(ev.commitsTotal, 150) + 0.3 * ramp(weeks, 8);
  const engineering = history * (0.3 * (ev.hasTests ? 1 : 0) + 0.2 * (ev.hasCI ? 1 : 0) + 0.25 * readme + 0.1 * (ev.license ? 1 : 0) + 0.15 * (ev.hasDocs ? 1 : 0));
  const completeness = 0.2 * (ev.description ? 1 : 0) + 0.35 * (demo ? 1 : 0) + 0.15 * (ev.topics > 0 ? 1 : 0) + 0.1 * (ev.releases > 0 ? 1 : 0) + 0.2 * (recent ? 1 : 0);
  const recognition = 0.7 * logRef(ev.stars, 100) + 0.3 * logRef(ev.forks, 25);

  const kb = Math.round(ev.codeBytes / 1024);
  const parts: ProjectPart[] = [
    {
      key: "substance",
      label: "Build substance",
      weight: PROJECT_WEIGHTS.substance,
      value: clamp01(substance),
      evidence: `${kb.toLocaleString("en-US")} KB of code${ev.languages[0] ? ` (mostly ${ev.languages[0].name})` : ""}, ${plural(ev.commitsTotal, "commit")} in history, ${plural(weeks, "week")} of work by the applicant`,
    },
    {
      key: "engineering",
      label: "Engineering quality",
      weight: PROJECT_WEIGHTS.engineering,
      value: clamp01(engineering),
      evidence: [
        ev.hasTests ? "tests" : "no tests",
        ev.hasCI ? "CI" : "no CI",
        ev.readmeBytes > 1500 ? "a substantial README" : ev.readmeBytes > 300 ? "a short README" : "no real README",
        ev.license ? `licence (${ev.license})` : "no licence",
        ev.hasDocs ? "docs" : null,
      ]
        .filter(Boolean)
        .join(", "),
    },
    {
      key: "completeness",
      label: "Completeness",
      weight: PROJECT_WEIGHTS.completeness,
      value: clamp01(completeness),
      evidence: [
        demo ? `live demo (${ev.homepage!.replace(/^https?:\/\//, "").slice(0, 40)})` : "no live demo linked",
        ev.description ? "described" : "no description",
        ev.topics > 0 ? "topics" : null,
        ev.releases > 0 ? plural(ev.releases, "release") : null,
        recent ? "worked on in the last six months" : "not updated in six months",
      ]
        .filter(Boolean)
        .join(", "),
    },
    {
      key: "recognition",
      label: "Recognition",
      weight: PROJECT_WEIGHTS.recognition,
      value: clamp01(recognition),
      evidence: `${plural(ev.stars, "star")}, ${plural(ev.forks, "fork")}`,
    },
  ];

  const quality = parts.reduce((s, p) => s + p.weight * p.value, 0);
  const score = round1(100 * quality * factor);
  return {
    methodology: PROJECT_METHODOLOGY,
    repo: ev.nameWithOwner,
    url: ev.url,
    description: ev.description,
    language: ev.languages[0]?.name ?? null,
    score,
    band: bandFor(score),
    quality: round1(100 * quality),
    share,
    authorshipFactor: Math.round(factor * 100) / 100,
    owned,
    fork: ev.isFork,
    parts,
    notes,
  };
}

/* ---------------------------------------------------------- combining with the profile ---------------------------------------------------------- */

/** What happens to someone without a gradable best project. */
export type ProjectMissingPolicy = "github" | "zero";

/** One person's final score: (1 − w) × GitHub profile + w × best project. */
export function personScore(github: number, project: number | null, weight: number, missing: ProjectMissingPolicy): number {
  const w = clamp01(weight);
  if (project === null) return missing === "github" ? github : (1 - w) * github;
  return (1 - w) * github + w * project;
}

export interface MemberBreakdown {
  label: string;
  login: string | null;
  name: string | null;
  weight: number;
  isLeader: boolean;
  /** GitHub profile score (0 for a member without a usable account, when they count as 0). */
  github: number;
  project: number | null;
  projectRepo: string | null;
  projectLink: string | null;
  /** Why there is no project score, when there isn't. */
  projectNote: string | null;
}

/** A team's final score from its members' breakdown, for a given project weight. */
export function teamScore(members: MemberBreakdown[], weight: number, missing: ProjectMissingPolicy) {
  const total = members.reduce((s, m) => s + m.weight * personScore(m.github, m.project, weight, missing), 0);
  const github = members.reduce((s, m) => s + m.weight * m.github, 0);
  const withProject = members.filter((m) => m.project !== null);
  const pw = withProject.reduce((s, m) => s + m.weight, 0);
  const project = pw > 0 ? withProject.reduce((s, m) => s + m.weight * m.project!, 0) / pw : null;
  return { total: round1(total), band: bandFor(round1(total)), github: round1(github), project: project === null ? null : round1(project) };
}
