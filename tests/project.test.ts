import { describe, expect, it } from "vitest";
import { assessProject, parseProjectRef, personScore, teamScore, type MemberBreakdown, type ProjectEvidence } from "@/lib/scoring/project";

const NOW = "2026-11-16T00:00:00Z";
const base = (over: Partial<ProjectEvidence> = {}): ProjectEvidence => ({
  nameWithOwner: "asha/tracker",
  url: "https://github.com/asha/tracker",
  description: "Tracks things",
  homepage: "https://tracker.vercel.app",
  stars: 3,
  forks: 1,
  archived: false,
  createdAt: "2026-03-01T00:00:00Z",
  pushedAt: "2026-11-01T00:00:00Z",
  diskKb: 900,
  license: "MIT",
  topics: 2,
  releases: 0,
  languages: [{ name: "TypeScript", color: null, share: 1 }],
  readmeBytes: 4000,
  hasTests: true,
  hasCI: true,
  hasDocs: false,
  commitsTotal: 120,
  commitsByOwner: 110,
  authoredWeeks: 14,
  commitsSource: "history",
  owned: true,
  codeBytes: 300_000,
  isFork: false,
  parent: null,
  person: "asha",
  fetchedAt: NOW,
  ...over,
});

describe("best-project links", () => {
  it.each([
    ["https://github.com/asha/tracker", { owner: "asha", name: "tracker" }],
    ["github.com/asha/tracker.git", { owner: "asha", name: "tracker" }],
    ["https://github.com/asha/tracker/tree/main/src", { owner: "asha", name: "tracker" }],
    ["https://asha.github.io/portfolio/", { owner: "asha", name: "portfolio" }],
    ["https://asha.github.io", { owner: "asha", name: "asha.github.io" }],
  ])("%s", (link, ref) => expect(parseProjectRef(link)).toEqual(ref));

  it("profiles, other sites and blanks are not gradable", () => {
    expect(parseProjectRef("https://github.com/asha")).toEqual({ problem: "not_repo" });
    expect(parseProjectRef("https://github.com/settings/profile")).toEqual({ problem: "not_repo" });
    expect(parseProjectRef("https://asha.vercel.app")).toEqual({ problem: "not_repo" });
    expect(parseProjectRef("")).toEqual({ problem: "missing" });
    expect(parseProjectRef(null)).toEqual({ problem: "missing" });
  });
});

describe("best-project grade", () => {
  it("a well-built project the applicant wrote scores high, and every part has evidence", () => {
    const a = assessProject(base());
    expect(a.score).toBeGreaterThan(70);
    expect(a.share).toBeCloseTo(110 / 120);
    expect(a.parts.every((p) => p.evidence.length > 0)).toBe(true);
  });

  it("is deterministic", () => expect(assessProject(base())).toEqual(assessProject(base())));

  it("someone else's repository with no commits from the applicant keeps 30%", () => {
    const own = assessProject(base());
    const theirs = assessProject(base({ nameWithOwner: "other/tracker", commitsByOwner: 0 }));
    expect(theirs.share).toBe(0);
    expect(theirs.score).toBeCloseTo(own.quality * 0.3, 0);
    expect(theirs.notes.join(" ")).toContain("no commits");
  });

  it("a fork earns only for the applicant's own commits", () => {
    const fork = assessProject(base({ isFork: true, parent: "big/upstream", commitsTotal: 2000, commitsByOwner: 10 }));
    expect(fork.share).toBeCloseTo(0.005);
    expect(fork.score).toBeLessThan(assessProject(base()).score / 2);
  });

  it("the same code in one commit counts less than code grown over a history", () => {
    const dump = assessProject(base({ commitsTotal: 1, commitsByOwner: 1, authoredWeeks: 1 }));
    expect(dump.score).toBeLessThan(assessProject(base()).score - 25);
    expect(dump.notes.join(" ")).toContain("Only 1 commit");
  });

  it("an owned repository with unattributable commits assumes a 60% share", () => {
    const a = assessProject(base({ commitsByOwner: 0 }));
    expect(a.share).toBeNull();
    expect(a.authorshipFactor).toBe(1);
  });
});

describe("combining with the GitHub profile", () => {
  it("70/30 by default arithmetic", () => {
    expect(personScore(60, 80, 0.3, "github")).toBeCloseTo(66);
    expect(personScore(60, null, 0.3, "github")).toBe(60);
    expect(personScore(60, null, 0.3, "zero")).toBeCloseTo(42);
    expect(personScore(60, 80, 0, "github")).toBe(60);
  });

  it("team score is the lead-weighted sum of person scores; re-weighting needs no new data", () => {
    const members: MemberBreakdown[] = [
      { label: "a", login: "a", name: "A", weight: 0.4, isLeader: true, github: 70, project: 90, projectRepo: "a/x", projectLink: null, projectNote: null },
      { label: "b", login: "b", name: "B", weight: 0.3, isLeader: false, github: 50, project: null, projectRepo: null, projectLink: null, projectNote: "No best project given" },
      { label: "~C", login: null, name: "C", weight: 0.3, isLeader: false, github: 0, project: null, projectRepo: null, projectLink: null, projectNote: "No usable GitHub account" },
    ];
    const r = teamScore(members, 0.3, "github");
    expect(r.total).toBeCloseTo(0.4 * (0.7 * 70 + 0.3 * 90) + 0.3 * 50, 1);
    expect(r.github).toBeCloseTo(0.4 * 70 + 0.3 * 50, 1);
    expect(r.project).toBe(90);
    expect(teamScore(members, 0, "github").total).toBe(r.github);
  });
});
