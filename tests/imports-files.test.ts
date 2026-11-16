import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extract } from "@/lib/imports/extract";
import { exportUrl, jsonContent, pipeRows, readBytes, ReadError } from "@/lib/imports/read";

const dir = new URL("./fixtures/imports/", import.meta.url);
const load = (name: string) => readBytes(new Uint8Array(readFileSync(new URL(name, dir))), name);
const shape = async (name: string) =>
  extract(await load(name)).teams.map((t) => `${t.name}[${t.members.map((m) => `${m.leader ? "*" : ""}${m.github ?? "-"}`).join(",")}]`);

const FULL = [
  "Rocket[*gaearon,tj,antfu]",
  "Nova[*sindresorhus,shadcn]",
  "Orbit[kentcdodds,mitchellh]",
  "Solo Star[*yyx990803]",
  "Ghost[*zz-not-a-real-user-91827,addyosmani]",
  "Paper[*-,-]",
];
const PEOPLE = FULL.slice(0, 4);
/** Forms list Rocket twice with different leads: two teams, each shown with its lead. */
const FORM = ["Rocket · Dan Abramov[*gaearon,tj,antfu]", ...FULL.slice(1), "Rocket · Addy Osmani[*addyosmani]"];

describe("every supported format yields the same teams", () => {
  it.each([
    ["form.csv", FORM],
    ["form.xlsx", FORM],
    ["form-table.html", FORM],
    ["form-table.docx", FORM],
    ["form-table.pdf", FORM],
    ["people.csv", PEOPLE],
    ["people.tsv", PEOPLE],
    ["people.xlsx", PEOPLE],
    ["blocks.txt", FULL],
    ["blocks.docx", FULL],
    ["blocks.pdf", FULL],
    ["table.md", ["Rocket[*gaearon,tj]", "Nova[*sindresorhus,shadcn]", "Solo Star[*yyx990803]"]],
    ["teams.json", ["Rocket[*gaearon,tj]", "Nova[*sindresorhus,shadcn]"]],
    ["links.html", ["Rocket[*gaearon,tj]", "Nova[*sindresorhus]"]],
  ])("%s", async (file, expected) => {
    expect(await shape(file)).toEqual(expected);
  });

  it("keeps e-mails from spreadsheets and PDFs", async () => {
    for (const f of ["form.csv", "form-table.pdf", "form.xlsx"]) {
      const lead = extract(await load(f)).teams[0]!.members[0]!;
      expect(lead).toMatchObject({ name: "Dan Abramov", email: "dan@example.com", github: "gaearon", leader: true });
    }
  });
});

describe("unreadable input fails with a clear message", () => {
  it.each([
    ["blocks.doc", /Old \.doc\/\.xls/],
    ["people.xls", /Old \.doc\/\.xls/],
    ["corrupt.xlsx", /damaged/],
    ["scan.pdf", /no selectable text/],
  ])("%s", async (file, message) => {
    await expect(load(file)).rejects.toThrow(ReadError);
    await expect(load(file)).rejects.toThrow(message);
  });

  it("finds no GitHub accounts where there are none", async () => {
    for (const f of ["empty.csv", "no-github.csv"]) {
      const teams = extract(await load(f)).teams;
      expect(teams.some((t) => t.members.some((m) => m.github))).toBe(false);
    }
  });

  it("rejects files over 25 MB", async () => {
    await expect(readBytes(new Uint8Array(25 * 1024 * 1024 + 1), "big.csv")).rejects.toThrow(/25 MB/);
  });
});

describe("links", () => {
  it("turns Google share links into export links", () => {
    expect(exportUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=42").url).toBe(
      "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=42",
    );
    expect(exportUrl("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing").url).toBe(
      "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=html",
    );
    expect(exportUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing").url).toBe(
      "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp",
    );
    expect(exportUrl("https://example.com/teams.csv").url).toBe("https://example.com/teams.csv");
  });

  it("refuses forms, non-links and non-http schemes", () => {
    expect(() => exportUrl("https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/viewform")).toThrow(/response sheet/);
    expect(() => exportUrl("not a link")).toThrow(ReadError);
    expect(() => exportUrl("file:///etc/passwd")).toThrow(/http/);
  });
});

describe("structured text", () => {
  it("reads pipe tables and JSON records", () => {
    expect(pipeRows("| a | b |\n|---|---|\n| 1 | 2 |")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(pipeRows("no table here")).toBeNull();
    expect(jsonContent([{ team: "X", github: "a" }]).rows).toEqual([
      ["team", "github"],
      ["X", "a"],
    ]);
  });
});
