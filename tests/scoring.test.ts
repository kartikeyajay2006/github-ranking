import { describe, expect, it } from "vitest";
import { logRef, ramp } from "@/lib/scoring/curves";
import {
  DIMENSION_WEIGHTS,
  PORTFOLIO_WEIGHTS,
  REPO_GROUP_MAX,
  assess,
  authorship,
  authorshipFactor,
  bandFor,
  classifyPull,
  orientationFor,
  prSubstance,
  prWeight,
  repoGroups,
  workSplit,
} from "@/lib/scoring/individual";
import { assessTeam, teamWeights } from "@/lib/scoring/team";
import type { ProfileEvidence, RepoEvidence } from "@/lib/types";

const NOW = Date.parse("2026-11-13T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function repo(overrides: Partial<RepoEvidence> = {}): RepoEvidence {
  return {
    nameWithOwner: "dev/project",
    url: "https://github.com/dev/project",
    description: "A project",
    homepage: null,
    stars: 0,
    forks: 0,
    archived: false,
    createdAt: daysAgo(400),
    pushedAt: daysAgo(10),
    diskKb: 500,
    license: "MIT",
    topics: 2,
    releases: 0,
    languages: [{ name: "TypeScript", color: "#3178c6", share: 1 }],
    readmeBytes: 5000,
    hasTests: true,
    hasCI: true,
    hasDocs: false,
    commitsTotal: 120,
    commitsByOwner: 100,
    ...overrides,
  };
}

function evidence(overrides: Partial<ProfileEvidence> = {}): ProfileEvidence {
  const calendar = Array.from({ length: 365 }, (_, i) => ({ date: daysAgo(364 - i).slice(0, 10), count: i % 2 ? 3 : 0 }));
  return {
    login: "dev",
    name: "Dev",
    avatarUrl: "",
    bio: null,
    company: null,
    location: null,
    websiteUrl: null,
    createdAt: daysAgo(2000),
    followers: 40,
    following: 10,
    ownedRepoCount: 3,
    forkCount: 0,
    repos: [
      { nameWithOwner: "dev/a", stars: 30, forks: 4, language: "TypeScript", diskKb: 900, pushedAt: daysAgo(5), hasDescription: true, archived: false },
      { nameWithOwner: "dev/b", stars: 2, forks: 0, language: "Go", diskKb: 300, pushedAt: daysAgo(50), hasDescription: true, archived: false },
      { nameWithOwner: "dev/c", stars: 0, forks: 0, language: "Python", diskKb: 120, pushedAt: daysAgo(500), hasDescription: false, archived: false },
    ],
    reposTruncated: false,
    inspected: [
      repo({ nameWithOwner: "dev/a", stars: 30, forks: 4 }),
      repo({ nameWithOwner: "dev/b", stars: 2, hasCI: false, license: null }),
      repo({ nameWithOwner: "dev/c", readmeBytes: 0, hasTests: false, hasCI: false, pushedAt: daysAgo(500), commitsByOwner: 4 }),
    ],
    year: {
      from: daysAgo(365),
      to: daysAgo(0),
      calendar,
      totalContributions: 546,
      restricted: 0,
      commitsOwn: 400,
      commitsExternal: 60,
      pullsOwn: 10,
      pullsExternal: 12,
      reviewsExternal: 5,
      issuesExternal: 3,
      reposTouched: 9,
    },
    external: {
      merged: 12,
      closedUnmerged: 3,
      open: 1,
      issues: 8,
      sample: [
        { repo: "big/framework", stars: 50_000, mergedAt: daysAgo(30) },
        { repo: "small/tool", stars: 15, mergedAt: daysAgo(60) },
      ],
    },
    fetchedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("curves", () => {
  it("saturate at the reference point and never exceed 1", () => {
    expect(logRef(0, 100)).toBe(0);
    expect(logRef(100, 100)).toBeCloseTo(1);
    expect(logRef(10_000, 100)).toBe(1);
    expect(logRef(-5, 100)).toBe(0);
    expect(ramp(50, 100)).toBe(0.5);
  });

  it("give diminishing returns", () => {
    const first = logRef(10, 1000) - logRef(0, 1000);
    const later = logRef(110, 1000) - logRef(100, 1000);
    expect(first).toBeGreaterThan(later * 5);
  });
});

describe("weights", () => {
  it("sum to 1 at every level", () => {
    expect(Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(PORTFOLIO_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(Object.values(REPO_GROUP_MAX).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    for (const d of assess(evidence(), NOW).dimensions) expect(d.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });

  it("a perfect repository scores exactly 1", () => {
    const g = repoGroups(repo({ stars: 1000, forks: 150, homepage: "x", hasDocs: true, releases: 3, commitsByOwner: 200 }), NOW);
    expect(g.documentation + g.hygiene + g.sustained + g.adoption).toBeCloseTo(1);
  });

  it("weights merged PRs by the target project's stature", () => {
    expect(prWeight(0)).toBeCloseTo(0.4);
    expect(prWeight(2000)).toBeCloseTo(1);
    expect(prWeight(100)).toBeGreaterThan(prWeight(5));
  });
});

describe("assess", () => {
  it("is deterministic and the ledger reconciles to the total", () => {
    const a = assess(evidence(), NOW);
    const b = assess(evidence(), NOW);
    expect(a).toEqual(b);
    const fromDims = a.dimensions.reduce((s, d) => s + d.score * d.weight, 0);
    expect(a.total).toBeCloseTo(fromDims, 0);
    const fromFactors = a.dimensions.reduce((s, d) => s + d.factors.reduce((t, f) => t + f.value * f.weight, 0) * d.weight * 100, 0);
    expect(a.total).toBeCloseTo(fromFactors, 0);
    expect(a.total).toBeGreaterThan(0);
    expect(a.total).toBeLessThanOrEqual(100);
  });

  it("an empty account scores near zero without crashing", () => {
    const a = assess(
      evidence({
        repos: [],
        inspected: [],
        ownedRepoCount: 0,
        followers: 0,
        external: { merged: 0, closedUnmerged: 0, open: 0, issues: 0, sample: [] },
        year: { ...evidence().year, calendar: [], totalContributions: 0, commitsOwn: 0, commitsExternal: 0, pullsOwn: 0, pullsExternal: 0, reviewsExternal: 0, reposTouched: 0 },
      }),
      NOW,
    );
    expect(a.total).toBe(0);
    expect(a.band).toBe("Emerging");
    expect(a.orientation).toBe("Insufficient activity");
    expect(a.notes.some((n) => n.includes("no public original repositories"))).toBe(true);
  });

  it("excludes the profile README repository from project quality", () => {
    const withProfile = evidence({ inspected: [...evidence().inspected, repo({ nameWithOwner: "dev/dev", stars: 999 })] });
    expect(assess(withProfile, NOW).repos.some((r) => r.nameWithOwner === "dev/dev")).toBe(false);
  });

  it("better evidence never lowers a score", () => {
    const base = assess(evidence(), NOW).total;
    const more = assess(evidence({ external: { ...evidence().external, merged: 40 } }), NOW).total;
    expect(more).toBeGreaterThanOrEqual(base);
  });
});

describe("bands and orientation", () => {
  it("map scores to bands at fixed cut-offs", () => {
    expect(bandFor(80)).toBe("Exceptional");
    expect(bandFor(79.9)).toBe("Strong");
    expect(bandFor(50)).toBe("Proficient");
    expect(bandFor(34.9)).toBe("Emerging");
  });

  it("classify own vs external work", () => {
    expect(orientationFor(90, 10)).toBe("Builder-led");
    expect(orientationFor(50, 50)).toBe("Balanced");
    expect(orientationFor(10, 90)).toBe("Contributor-led");
    expect(orientationFor(3, 3)).toBe("Insufficient activity");
  });
});

describe("team weights", () => {
  it("gives a single member 100%", () => {
    expect(teamWeights(["a"], "a", "leader")).toEqual([1]);
    expect(teamWeights(["a"], null, "equal")).toEqual([1]);
  });

  it("gives a lead of three 40/30/30", () => {
    const w = teamWeights(["a", "b", "c"], "b", "leader");
    expect(w[0]).toBeCloseTo(0.3);
    expect(w[1]).toBeCloseTo(0.4);
    expect(w[2]).toBeCloseTo(0.3);
  });

  it("gives a lead of two 60/40, and sums to 1 for any size", () => {
    const two = teamWeights(["a", "b"], "a", "leader");
    expect(two[0]).toBeCloseTo(0.6);
    expect(two[1]).toBeCloseTo(0.4);
    for (let n = 2; n <= 12; n++) {
      const logins = Array.from({ length: n }, (_, i) => `m${i}`);
      expect(teamWeights(logins, "m0", "leader").reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });

  it("falls back to an equal average without a lead or in equal mode", () => {
    expect(teamWeights(["a", "b", "c", "d"], null, "leader")).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(teamWeights(["a", "b", "c", "d"], "a", "equal")).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(teamWeights(["a", "b"], "nobody", "leader")).toEqual([0.5, 0.5]);
  });

  it("matches the lead case-insensitively", () => {
    expect(teamWeights(["Alice", "bob", "carl"], "alice", "leader")[0]).toBeCloseTo(0.4);
  });
});

describe("team assessment", () => {
  const strong = assess(evidence(), NOW);
  const weak = assess(evidence({ external: { merged: 0, closedUnmerged: 0, open: 0, issues: 0, sample: [] }, followers: 0 }), NOW);

  it("leaves every member's own score untouched", () => {
    const before = JSON.stringify([strong, weak]);
    const team = assessTeam(
      [
        { login: "s", assessment: strong },
        { login: "w", assessment: weak },
      ],
      "w",
      "leader",
    )!;
    expect(JSON.stringify([strong, weak])).toBe(before);
    expect(team.members.find((m) => m.login === "s")!.score).toBe(strong.total);
  });

  it("is the weighted mean of member totals", () => {
    const team = assessTeam(
      [
        { login: "s", assessment: strong },
        { login: "w", assessment: weak },
      ],
      "s",
      "leader",
    )!;
    expect(team.total).toBeCloseTo(0.6 * strong.total + 0.4 * weak.total, 0);
  });

  it("a solo team equals its member", () => {
    expect(assessTeam([{ login: "s", assessment: strong }], null, "leader")!.total).toBe(strong.total);
  });

  it("reports pending members and returns null when nobody is analysed", () => {
    expect(assessTeam([{ login: "x", assessment: null }], null, "equal")).toBeNull();
    const t = assessTeam(
      [
        { login: "s", assessment: strong },
        { login: "x", assessment: null },
      ],
      null,
      "equal",
    )!;
    expect(t.pending).toEqual(["x"]);
    expect(t.total).toBe(strong.total);
  });
});

describe("pull request classification", () => {
  const pr = (o: Partial<import("@/lib/types").ExternalPullRequest>) => ({ repo: "big/framework", stars: 9000, mergedAt: daysAgo(3), lines: 200, association: "CONTRIBUTOR", selfMerged: false, ...o });

  it("counts only peer-reviewed outside work as open source", () => {
    expect(classifyPull(pr({}))).toBe("outside");
    expect(classifyPull(pr({ association: "FIRST_TIME_CONTRIBUTOR" }))).toBe("outside");
    expect(classifyPull(pr({ association: "MEMBER" }))).toBe("team");
    expect(classifyPull(pr({ association: "COLLABORATOR" }))).toBe("team");
    expect(classifyPull(pr({ selfMerged: true }))).toBe("team");
  });

  it("recognises contribution farms", () => {
    for (const repo of ["x/Hacktoberfest-2024", "x/first-contributions", "x/Code-Contribution", "x/Leetcode-Questions", "x/HacktoberWall"])
      expect(classifyPull(pr({ repo }))).toBe("farm");
    expect(classifyPull(pr({ repo: "sktime/sktime" }))).toBe("outside");
  });

  it("weights larger changes more", () => {
    expect(prSubstance(1)).toBeLessThan(0.5);
    expect(prSubstance(150)).toBeCloseTo(1);
    expect(prSubstance(undefined)).toBe(1);
  });

  const base = evidence();
  const teamOnly = evidence({
    external: { merged: 30, closedUnmerged: 0, open: 0, issues: 0, sample: Array.from({ length: 30 }, () => pr({ repo: "myorg/startup", stars: 50, association: "MEMBER", selfMerged: true })) },
  });
  const outsideOnly = evidence({
    external: { merged: 30, closedUnmerged: 0, open: 0, issues: 0, sample: Array.from({ length: 30 }, (_, i) => pr({ repo: `org${i % 6}/lib`, stars: 5000 })) },
  });
  const farmOnly = evidence({
    external: { merged: 30, closedUnmerged: 0, open: 0, issues: 0, sample: Array.from({ length: 30 }, () => pr({ repo: "x/hacktoberfest-2025", stars: 300, lines: 30 })) },
  });
  const oss = (e: ProfileEvidence) => assess(e, NOW).dimensions.find((d) => d.key === "opensource")!;

  it("gives team PRs no open-source credit and farms very little", () => {
    expect(oss(teamOnly).factors.find((f) => f.key === "merged")!.value).toBe(0);
    expect(oss(farmOnly).score).toBeLessThan(oss(outsideOnly).score / 2);
    expect(oss(outsideOnly).score).toBeGreaterThan(oss(base).score);
  });

  it("reports the breakdown", () => {
    const p = assess(teamOnly, NOW).pulls!;
    expect(p).toMatchObject({ outside: 0, team: 30, farm: 0, selfMerged: 30 });
  });
});

describe("authorship", () => {
  it("credits repositories by the share the person wrote", () => {
    expect(authorshipFactor(null)).toBe(1);
    expect(authorshipFactor(0.5)).toBe(1);
    expect(authorshipFactor(0.25)).toBeCloseTo(0.7);
    expect(authorshipFactor(0)).toBeCloseTo(0.4);
    expect(authorship(repo({ commitsTotal: 200, commitsByOwner: 50 }))).toBeCloseTo(0.25);
    expect(authorship(repo({ commitsTotal: 200, commitsByOwner: 0 }))).toBeNull(); // owned, unlinked e-mail
  });

  it("counts team repositories by authorship and drops ones barely touched", () => {
    const team = repo({ nameWithOwner: "org/product", owned: false, stars: 400, commitsTotal: 300, commitsByOwner: 150 });
    const touched = repo({ nameWithOwner: "org/other", owned: false, stars: 900, commitsTotal: 1000, commitsByOwner: 20 });
    const a = assess(evidence({ inspected: [...evidence().inspected, team, touched] }), NOW);
    expect(a.repos.find((r) => r.nameWithOwner === "org/product")).toMatchObject({ owned: false, authorship: 0.5 });
    expect(a.repos.some((r) => r.nameWithOwner === "org/other")).toBe(false);
  });

  it("a solo author outranks a light co-author on an otherwise identical repository", () => {
    const solo = assess(evidence({ inspected: [repo({ commitsTotal: 100, commitsByOwner: 100 })] }), NOW);
    const light = assess(evidence({ inspected: [repo({ commitsTotal: 400, commitsByOwner: 100 })] }), NOW);
    expect(solo.repos[0]!.quality).toBeGreaterThan(light.repos[0]!.quality);
  });
});

describe("work split", () => {
  it("treats insider repositories as own & team work", () => {
    const e = evidence({
      year: {
        ...evidence().year,
        byRepo: [
          { repo: "dev/a", owner: "dev", commits: 50, pulls: 0 },
          { repo: "myorg/startup", owner: "myorg", commits: 40, pulls: 10 },
          { repo: "big/framework", owner: "big", commits: 5, pulls: 5 },
        ],
      },
      external: { merged: 2, closedUnmerged: 0, open: 0, issues: 0, sample: [{ repo: "myorg/startup", stars: 3, mergedAt: daysAgo(2), association: "MEMBER", selfMerged: true, lines: 50 }] },
    });
    expect(workSplit(e)).toEqual({ own: 100, external: 10 });
  });
});

describe("followers", () => {
  it("carry at most 5% of impact", () => {
    const quiet = assess(evidence({ followers: 0 }), NOW).total;
    const popular = assess(evidence({ followers: 100_000 }), NOW).total;
    expect(popular - quiet).toBeLessThanOrEqual(DIMENSION_WEIGHTS.impact * 5 + 0.1);
  });
});

describe("issues and reviews", () => {
  it("only count in outside projects", () => {
    const sample = [{ repo: "myorg/startup", stars: 3, mergedAt: daysAgo(2), association: "MEMBER", selfMerged: true, lines: 50 }];
    const insider = evidence({
      external: { merged: 1, closedUnmerged: 0, open: 0, issues: 40, sample, issueSample: Array.from({ length: 40 }, () => ({ repo: "myorg/startup", association: "MEMBER" })) },
      year: { ...evidence().year, reviewsExternal: 20, reviewsByRepo: [{ repo: "myorg/startup", count: 20 }] },
    });
    const outside = evidence({
      external: { merged: 1, closedUnmerged: 0, open: 0, issues: 40, sample, issueSample: Array.from({ length: 40 }, () => ({ repo: "big/lib", association: "NONE" })) },
      year: { ...evidence().year, reviewsExternal: 20, reviewsByRepo: [{ repo: "big/lib", count: 20 }] },
    });
    const value = (e: ProfileEvidence) => assess(e, NOW).dimensions.find((d) => d.key === "opensource")!.factors.find((f) => f.key === "engagement")!.value;
    expect(value(insider)).toBe(0);
    expect(value(outside)).toBeGreaterThan(0.9);
  });
});
