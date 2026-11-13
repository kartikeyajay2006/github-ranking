import { describe, expect, it } from "vitest";
import { cleanName, extract, fromRows, fromText, githubHandles, handleFromCell, leaderOf } from "@/lib/imports/extract";
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
    expect(teams.map((t) => t.name)).toEqual(["Alpha", "Alpha (2)"]);
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
