import { describe, expect, it } from "vitest";
import { cleanName, extract, fromRows, fromText, githubHandles, handleFromCell, isWithdrawnTeam, leaderOf, projectLink } from "@/lib/imports/extract";
import Papa from "papaparse";

const csv = (s: string) => Papa.parse<string[]>(s.trim(), { skipEmptyLines: true }).data;
const summary = (teams: ReturnType<typeof extract>["teams"]) =>
  teams.map((t) => ({ name: t.name, members: t.members.map((m) => `${m.leader ? "*" : ""}${m.name ?? "?"}:${m.github ?? "-"}`) }));

describe("primitives", () => {
  it("finds GitHub accounts but not repositories or GitHub's own pages", () => {
    expect(githubHandles("see https://github.com/alice and github.com/Bob-1/ ok")).toEqual(["alice", "Bob-1"]);
    expect(githubHandles("project: https://github.com/team/repo")).toEqual([]);
    expect(githubHandles("https://github.com/features https://github.com/orgs/x")).toEqual([]);
    expect(githubHandles("GitHub: carol99, GitHub ID - dave")).toEqual(["carol99", "dave"]);
  });

  it("reads GitHub cells in any common form", () => {
    expect(handleFromCell("@alice")).toBe("alice");
    expect(handleFromCell("https://www.github.com/alice/")).toBe("alice");
    expect(handleFromCell("alice")).toBe("alice");
    expect(handleFromCell("not a handle")).toBeNull();
  });

  it("cleans names", () => {
    expect(cleanName("Member 2: Priya Sharma (priya@x.com)")).toBe("Priya Sharma");
    expect(cleanName("Team Leader - Arjun Rao github.com/arjun")).toBe("Arjun Rao");
    expect(cleanName("N/A")).toBeNull();
  });
});

describe("rows", () => {
  it("reads a Google Form export with a lead and numbered members", () => {
    const rows = csv(`
Timestamp,Team Name,Team Leader Name,Team Leader Email,Team Leader GitHub,Member 2 Name,Member 2 GitHub,Member 3 Name,Member 3 GitHub Profile
1/11/2026,Rocket,Arjun Rao,arjun@x.com,https://github.com/arjunrao,Priya Sharma,@priyas,Dev K,github.com/devk
1/11/2026,Nova,Sara Ali,sara@x.com,saraali,Tom Lee,https://github.com/tomlee,,
`);
    const r = fromRows(rows)!;
    expect(summary(r.teams)).toEqual([
      { name: "Rocket", members: ["*Arjun Rao:arjunrao", "Priya Sharma:priyas", "Dev K:devk"] },
      { name: "Nova", members: ["*Sara Ali:saraali", "Tom Lee:tomlee"] },
    ]);
    expect(r.teams[0]!.members[0]!.email).toBe("arjun@x.com");
  });

  it("reads one person per row grouped by team", () => {
    const rows = csv(`
Name,Email,GitHub,Team,Role
Arjun Rao,arjun@x.com,arjunrao,Rocket,Team Lead
Priya Sharma,priya@x.com,priyas,Rocket,Member
Sara Ali,sara@x.com,https://github.com/saraali,Nova,Leader
`);
    expect(summary(fromRows(rows)!.teams)).toEqual([
      { name: "Rocket", members: ["*Arjun Rao:arjunrao", "Priya Sharma:priyas"] },
      { name: "Nova", members: ["*Sara Ali:saraali"] },
    ]);
  });

  it("reads a single column listing every member's GitHub", () => {
    const rows = csv(`
Team name,Members,GitHub profiles of all members
Orbit,"Ann, Ben","https://github.com/ann
https://github.com/ben"
`);
    expect(summary(fromRows(rows)!.teams)).toEqual([{ name: "Orbit", members: ["Ann:ann", "Ben:ben"] }]);
  });

  it("warns about members without GitHub and de-duplicates team names", () => {
    const rows = csv(`
Team Name,Leader Name,Leader GitHub,Member 2 Name,Member 2 GitHub
Alpha,Ann,ann,Ben,
Alpha,Cat,cat,,
`);
    const teams = fromRows(rows)!.teams;
    expect(teams.map((t) => t.name)).toEqual(["Alpha · Ann", "Alpha · Cat"]);
    expect(teams[0]!.warnings.join(" ")).toContain("2 different teams are called “Alpha”");
    expect(teams[0]!.warnings.join(" ")).toContain("No GitHub found for Ben");
  });
});

describe("text", () => {
  it("reads team blocks from a document", () => {
    const text = `
Hackathon 2026 — Registered teams

Team 1: Rocket
Team Leader: Arjun Rao (arjun@x.com) — https://github.com/arjunrao
Member 2: Priya Sharma, GitHub: priyas
Member 3: Dev K
GitHub: https://github.com/devk
Project repo: https://github.com/rocket-team/app

Team 2 - Nova
Leader: Sara Ali
github.com/saraali
Member: Tom Lee github.com/tomlee
`;
    const r = fromText(text);
    expect(summary(r.teams)).toEqual([
      { name: "Rocket", members: ["*Arjun Rao:arjunrao", "Priya Sharma:priyas", "Dev K:devk"] },
      { name: "Nova", members: ["*Sara Ali:saraali", "Tom Lee:tomlee"] },
    ]);
  });

  it("reads 'Team Name:' forms", () => {
    const text = `
Team Name: Quasar
Name: Ann Lee
Email: ann@x.com
GitHub: annlee

Name: Bo Chen
GitHub: https://github.com/bochen

Team Name: Pulsar
Name: Cy
GitHub: cyx
`;
    expect(summary(fromText(text).teams)).toEqual([
      { name: "Quasar", members: ["Ann Lee:annlee", "Bo Chen:bochen"] },
      { name: "Pulsar", members: ["Cy:cyx"] },
    ]);
  });

  it("reads a flattened table, one team per line", () => {
    const text = `Team    Lead    Members
Orbit   Ann Lee  github.com/annlee   Ben Ko  github.com/benko
Comet   Cy Day   github.com/cyday`;
    expect(summary(fromText(text).teams)).toEqual([
      { name: "Orbit", members: ["Ann Lee:annlee", "Ben Ko:benko"] },
      { name: "Comet", members: ["Cy Day:cyday"] },
    ]);
  });

  it("falls back from unrecognised rows to text", () => {
    const r = extract({ rows: [["Orbit", "github.com/annlee", "github.com/benko"], ["Comet", "github.com/cyday", ""]] });
    expect(r.teams.map((t) => t.members.length)).toEqual([2, 1]);
  });
});

describe("leaderOf", () => {
  const team = { name: "T", warnings: [], members: [
    { name: "A", email: null, github: null, leader: false },
    { name: "B", email: null, github: "b", leader: false },
    { name: "C", email: null, github: "c", leader: true },
  ] };
  it("prefers the marked lead, else the first member with GitHub, else nobody", () => {
    expect(leaderOf(team, "first")).toBe(2);
    const unmarked = { ...team, members: team.members.map((m) => ({ ...m, leader: false })) };
    expect(leaderOf(unmarked, "first")).toBe(1);
    expect(leaderOf(unmarked, "equal")).toBeNull();
  });
});

describe("event-platform exports (two header rows, one person per row)", () => {
  // Shaped like a registration export: a group row above the real header, teams as blocks that start with
  // their leader, statuses, and a best-project column. All names and accounts here are made up.
  const sheet = csv(`
Team,Person,Person,,,Entry,,Registration,
Team,Name,Role,Email,Phone,Status,Paid,GitHub profile,LinkedIn Profile,Best Project You've Built So Far (Project Link)
Apex,Asha,Leader,asha@x.io,999,Confirmed,Free,https://github.com/asha-dev,https://linkedin.com/in/asha,https://github.com/asha-dev/tracker
Apex,Bilal,Member,bilal@x.io,999,Confirmed,Free,https://github.com/bilal-b,,https://github.com/asha-dev/tracker
Orion,Chen,Leader,chen@x.io,999,Confirmed,Free,github.com/chenw,,https://chen.vercel.app
Orion,Dev,Member,dev@x.io,999,Confirmed,Free,https://github.com/chenw,,
Apex,Esha,Leader,esha@x.io,999,Confirmed,Free,https://github.com/esha-k,,https://github.com/esha-k/notes-app/tree/main
Gone,Farid,Leader,farid@x.io,999,Withdrawn,Free,https://github.com/farid-f,,
Nova,Gita,Leader,gita@x.io,999,Confirmed,Free,https://gita-g.github.io/portfolio/,,n/a
Nova,Hari,Member,hari@x.io,999,Confirmed,Free,https://github.com/bilal-b,,
Nova,Gita,Leader,gita@x.io,999,Confirmed,Free,https://gita-g.github.io/portfolio/,,n/a
Orion,Chen,Leader,chen@x.io,999,Withdrawn,Free,github.com/chenw,,
`);
  const teams = extract({ rows: sheet }).teams;
  const byName = (n: string) => teams.find((t) => t.name === n)!;

  it("finds the real header under the group row and reads every column", () => {
    const apex = byName("Apex · Asha");
    expect(apex.members.map((m) => [m.name, m.github, m.leader, m.project])).toEqual([
      ["Asha", "asha-dev", true, "https://github.com/asha-dev/tracker"],
      ["Bilal", "bilal-b", false, "https://github.com/asha-dev/tracker"],
    ]);
  });

  it("keeps different teams with the same name apart, named by their lead", () => {
    expect(teams.map((t) => t.name)).toEqual(["Apex · Asha", "Orion", "Apex · Esha", "Gone", "Nova"]);
    expect(byName("Apex · Esha").warnings.join(" ")).toContain("also led by Asha");
  });

  it("merges a team registered twice under the same lead, and a person listed twice", () => {
    const orion = teams.filter((t) => t.name.startsWith("Orion"));
    expect(orion).toHaveLength(1);
    const nova = byName("Nova");
    expect(nova.members.filter((m) => m.name === "Gita")).toHaveLength(1);
  });

  it("an active row wins over a withdrawn one for the same person; withdrawn-only teams are marked", () => {
    expect(byName("Orion").members.find((m) => m.name === "Chen")!.withdrawn).toBe(false);
    expect(isWithdrawnTeam(byName("Gone"))).toBe(true);
  });

  it("two teammates with the same GitHub: the first keeps it, the other is flagged", () => {
    const orion = byName("Orion");
    expect(orion.members.map((m) => m.github)).toEqual(["chenw", null]);
    expect(orion.warnings.join(" ")).toContain("Dev gave the same GitHub as Chen");
  });

  it("a person in two active teams is flagged on both", () => {
    expect(byName("Apex · Asha").warnings.join(" ")).toContain("@bilal-b is also in “Nova”");
    expect(byName("Nova").warnings.join(" ")).toContain("@bilal-b is also in “Apex · Asha”");
  });

  it("reads GitHub Pages and repository links in the GitHub column as the account", () => {
    expect(byName("Nova").members[0]!.github).toBe("gita-g");
    expect(handleFromCell("https://github.com/someone/project")).toBe("someone");
    expect(handleFromCell("https://github.com/settings/profile")).toBeNull();
  });

  it("keeps the best-project link, preferring a GitHub repository", () => {
    expect(byName("Orion").members[0]!.project).toBe("https://chen.vercel.app");
    expect(byName("Nova").members[0]!.project).toBeNull();
    expect(projectLink("demo: https://x.vercel.app and code https://github.com/a/b")).toBe("https://github.com/a/b");
  });
});

describe("GitHub labels are not confused with names", () => {
  it("a repository or tool called github-something is not an account", () => {
    expect(githubHandles("code: https://github.com/asha/github-ranking")).toEqual([]);
    expect(githubHandles("built my-github-tool last year")).toEqual([]);
    expect(githubHandles("GitHub: asha-dev")).toEqual(["asha-dev"]);
    expect(githubHandles("GitHub - asha-dev")).toEqual(["asha-dev"]);
    expect(githubHandles("GitHub username – asha-dev")).toEqual(["asha-dev"]);
  });
});
