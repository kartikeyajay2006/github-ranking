import { describe, expect, it } from "vitest";
import { inspectionCandidates, normaliseLogin, readRepo } from "@/lib/github/collect";
import { parseLogins } from "@/lib/analyze";

describe("normaliseLogin", () => {
  it("accepts handles, @handles and profile URLs", () => {
    expect(normaliseLogin("torvalds")).toBe("torvalds");
    expect(normaliseLogin("@gaearon")).toBe("gaearon");
    expect(normaliseLogin("https://github.com/sindresorhus")).toBe("sindresorhus");
    expect(normaliseLogin("github.com/tj/commander.js")).toBe("tj");
    expect(normaliseLogin("  a-b-c  ")).toBe("a-b-c");
  });

  it("rejects invalid handles", () => {
    expect(normaliseLogin("")).toBeNull();
    expect(normaliseLogin("-leading")).toBeNull();
    expect(normaliseLogin("double--hyphen")).toBeNull();
    expect(normaliseLogin("has space")).toBeNull();
    expect(normaliseLogin("a".repeat(40))).toBeNull();
  });
});

describe("parseLogins", () => {
  it("splits on commas, spaces and newlines, de-duplicates case-insensitively and keeps invalid tokens", () => {
    const { logins, invalid } = parseLogins("alice, Bob\nbob  https://github.com/carol;bad--name @alice");
    expect(logins).toEqual(["alice", "Bob", "carol"]);
    expect(invalid).toEqual(["bad--name"]);
  });
});

describe("readRepo", () => {
  const base = {
    nameWithOwner: "dev/x",
    url: "u",
    description: " ",
    homepageUrl: "",
    stargazerCount: 3,
    forkCount: 1,
    isArchived: false,
    createdAt: "2024-01-01T00:00:00Z",
    pushedAt: "2026-11-01T00:00:00Z",
    diskUsage: 10,
    licenseInfo: { spdxId: "NOASSERTION", name: "Other" },
    repositoryTopics: { totalCount: 0 },
    releases: { totalCount: 0 },
    languages: { totalSize: 100, edges: [{ size: 75, node: { name: "Go", color: "#00ADD8" } }, { size: 25, node: { name: "Shell", color: null } }] },
    workflows: null,
    srcTest: null,
  };

  it("detects README, tests, CI and docs from the root tree", () => {
    const r = readRepo({
      ...base,
      root: {
        entries: [
          { name: "Readme.md", type: "blob", size: 2400 },
          { name: "main_test.go", type: "blob", size: 300 },
          { name: ".travis.yml", type: "blob", size: 100 },
          { name: "docs", type: "tree", size: 0 },
        ],
      },
    });
    expect(r.readmeBytes).toBe(2400);
    expect(r.hasTests).toBe(true);
    expect(r.hasCI).toBe(true);
    expect(r.hasDocs).toBe(true);
    expect(r.description).toBeNull();
    expect(r.homepage).toBeNull();
    expect(r.license).toBe("Custom");
    expect(r.languages[0]).toEqual({ name: "Go", color: "#00ADD8", share: 0.75 });
  });

  it("finds tests under src/test and CI in GitHub workflows", () => {
    const r = readRepo({ ...base, root: { entries: [] }, srcTest: { entries: [{ name: "java" }] }, workflows: { entries: [{ name: "ci.yml" }] } });
    expect(r.hasTests).toBe(true);
    expect(r.hasCI).toBe(true);
    expect(r.readmeBytes).toBe(0);
  });

  it("handles empty repositories", () => {
    const r = readRepo({ ...base, root: null, licenseInfo: null });
    expect(r.hasTests || r.hasCI || r.hasDocs).toBe(false);
    expect(r.license).toBeNull();
  });
});

describe("inspectionCandidates", () => {
  it("prefers starred, described, substantial, recent work and skips the profile README and empty repos", () => {
    const now = new Date().toISOString();
    const picks = inspectionCandidates(
      "dev",
      [
        { nameWithOwner: "dev/dev", stars: 50, forks: 0, language: null, diskKb: 5, pushedAt: now, hasDescription: true, archived: false },
        { nameWithOwner: "dev/empty", stars: 0, forks: 0, language: null, diskKb: 0, pushedAt: now, hasDescription: false, archived: false },
        { nameWithOwner: "dev/toy", stars: 0, forks: 0, language: "JS", diskKb: 20, pushedAt: "2019-01-01T00:00:00Z", hasDescription: false, archived: false },
        { nameWithOwner: "dev/real", stars: 12, forks: 2, language: "Go", diskKb: 4000, pushedAt: now, hasDescription: true, archived: false },
      ],
      2,
    );
    expect(picks).toEqual(["dev/real", "dev/toy"]);
  });
});
