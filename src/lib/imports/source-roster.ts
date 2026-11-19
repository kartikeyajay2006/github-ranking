import "server-only";
import Papa from "papaparse";

export interface RegistrationReference {
  name: string | null;
  github: string | null;
  email: string | null;
  college: string | null;
  leader: boolean;
}

const SOURCE_CSV = "https://docs.google.com/spreadsheets/d/16kczYrbyDhyYSn2tC-j4nanabNpE4-ObYwkGJZLLU_w/export?format=csv&gid=2125301195";
const CACHE_MS = 10 * 60_000;
type Registration = RegistrationReference & { team: string };
let cache: { expiresAt: number; rows: Registration[] } | null = null;
let pending: Promise<Registration[]> | null = null;

const key = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const handle = (value: string) => value.match(/github\.com\/([a-z\d-]+)/i)?.[1] ?? value.trim().replace(/^@/, "");

async function sourceRows(): Promise<Registration[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.rows;
  if (!pending) {
    pending = (async () => {
      const response = await fetch(SOURCE_CSV, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Registration source returned ${response.status}`);
      const parsed = Papa.parse<string[]>(await response.text(), { skipEmptyLines: "greedy" }).data;
      const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      const headerIndex = parsed.findIndex((row) => {
        const headers = row.map(normalizeHeader);
        return ["team", "name", "role", "email", "college"].every((field) => headers.includes(field)) && headers.some((field) => field.includes("github"));
      });
      if (headerIndex < 0) throw new Error("Registration source is missing required columns");
      const headers = parsed[headerIndex]!.map(normalizeHeader);
      const column = (name: string) => headers.indexOf(name);
      const githubColumn = headers.findIndex((field) => field.includes("github"));
      const rows: Registration[] = [];
      for (const row of parsed.slice(headerIndex + 1)) {
        const team = row[column("team")]?.trim() ?? "";
        const name = row[column("name")]?.trim() || null;
        const githubValue = row[githubColumn]?.trim() ?? "";
        const github = githubValue ? handle(githubValue) : null;
        if (!team || (!name && !github)) continue;
        rows.push({
          team,
          name,
          github,
          email: row[column("email")]?.trim() || null,
          college: row[column("college")]?.trim() || null,
          leader: /leader|captain|team\s*lead/i.test(row[column("role")] ?? ""),
        });
      }
      cache = { rows, expiresAt: Date.now() + CACHE_MS };
      return rows;
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}

function sameTeam(a: string, b: string) {
  const left = key(a);
  const right = key(b);
  return !!left && !!right && (left === right || left.startsWith(right) || right.startsWith(left));
}

/** Enrich imported roster entries with the provided registration sheet, while preserving the roster order. */
export async function enrichRegistrationRoster(teamName: string, roster: RegistrationReference[]): Promise<RegistrationReference[]> {
  try {
    const rows = await sourceRows();
    const teamRows = rows.filter((row) => sameTeam(row.team, teamName));
    return roster.map((person) => {
      const login = key(person.github);
      const personName = key(person.name);
      const email = key(person.email);
      const match = (candidates: Registration[]) =>
        candidates.find((row) => login && key(row.github) === login) ??
        candidates.find((row) => email && key(row.email) === email) ??
        candidates.find((row) => personName && key(row.name) === personName);
      const source = match(teamRows) ?? match(rows.filter((row) => {
        const identities = [login && key(row.github) === login, email && key(row.email) === email, personName && key(row.name) === personName];
        return identities.some(Boolean);
      }));
      return source
        ? {
            name: source.name || person.name,
            github: source.github || person.github,
            email: source.email || person.email,
            college: source.college || person.college,
            leader: source.leader || person.leader,
          }
        : person;
    });
  } catch (error) {
    console.error("[registration] Could not read the source sheet:", (error as Error).message);
    return roster;
  }
}
