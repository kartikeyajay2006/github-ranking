/**
 * Turns application documents into teams: a name, a lead, and members with their GitHub handles.
 *
 * Two shapes are understood:
 * - Rows (CSV, Excel, Google Sheets): header columns are recognised by meaning ("Team name",
 *   "Leader GitHub", "Member 2 email", "GitHub profiles"…), either one team per row or one person
 *   per row grouped by team name.
 * - Text (PDF, Word, Google Docs, pasted text): blocks introduced by "Team …" headings, or
 *   blank-line separated blocks, or one team per line for flattened tables.
 *
 * Everything here is pure and deterministic, so it is unit-tested without a network.
 */

export interface ExtractedMember {
  name: string | null;
  email: string | null;
  github: string | null;
  leader: boolean;
}

export interface ExtractedTeam {
  name: string;
  members: ExtractedMember[];
  warnings: string[];
}

export interface Extraction {
  teams: ExtractedTeam[];
  method: "table" | "text" | "ai";
  warnings: string[];
}

/* -------------------------------------------------------------- primitives -------------------------------------------------------------- */

const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const RESERVED = new Set(
  "about features pricing orgs organizations topics login signup join settings marketplace explore sponsors enterprise collections trending apps notifications issues pulls search site security customer-stories readme team contact new codespaces events github-copilot copilot resources solutions partners premium-support home dashboard".split(
    " ",
  ),
);
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})(\/[A-Za-z0-9_.-]+)?[^\s,;|)\]"'<>]*/gi;
const LABELLED_RE = /\bgit\s*hub\s*(?:id|user\s*name|username|handle|profile|account|link|url)?\s*[:=\-–—]\s*@?(?!https?\b|www\b)([A-Za-z0-9-]{1,39})\b(?![.:/])/gi;

export const isLogin = (s: string) => LOGIN_RE.test(s) && !RESERVED.has(s.toLowerCase());

/** GitHub accounts mentioned in a string: profile URLs and "GitHub: handle" labels. Repository links are not people. */
export function githubHandles(text: string): string[] {
  const out: string[] = [];
  const push = (h: string) => {
    if (isLogin(h) && !out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  };
  for (const m of text.matchAll(URL_RE)) {
    if (m[2]) continue; // github.com/owner/repo is a project link, not a person
    push(m[1]!);
  }
  for (const m of text.matchAll(LABELLED_RE)) {
    if (!/github\.com/i.test(m[0])) push(m[1]!);
  }
  return out;
}

/** A cell that is supposed to hold a GitHub account: URL, @handle or bare handle. */
export function handleFromCell(value: string): string | null {
  const found = githubHandles(value);
  if (found.length) return found[0]!;
  const bare = value.trim().replace(/^@/, "").replace(/\/$/, "");
  return bare && !/\s/.test(bare) && isLogin(bare) ? bare : null;
}

export const emailsIn = (text: string) => [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];

const LABEL_RE =
  /\b(team\s*)?(leader|lead|captain|head|member|participant|teammate|student|name|full\s*name|email|e-mail|mail|github|git\s*hub|profile|id|phone|mobile|contact|roll\s*no\.?|college|university)\b\s*#?\s*\d*\s*[:=\-–—]?/gi;

/** A person's display name with labels, links, e-mails and phone numbers removed. */
export function cleanName(raw: string): string | null {
  const s = raw
    .replace(LABELLED_RE, " ")
    .replace(URL_RE, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(EMAIL_RE, " ")
    .replace(/\+?\d[\d\s-]{7,}\d/g, " ")
    .replace(/\(\s*(?:team\s*)?(?:leader|lead|captain)\s*\)/gi, " ")
    .replace(LABEL_RE, " ")
    .replace(/^[\s\d.)\-•*–—|:]+/, "")
    .replace(/[|:;,•*–—]+/g, " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length > 60 || !/[a-z]/i.test(s) || /^(yes|no|n\/a|na|none|-)$/i.test(s)) return null;
  return s;
}

function dedupe(members: ExtractedMember[]): ExtractedMember[] {
  const out: ExtractedMember[] = [];
  for (const m of members) {
    const same = out.find(
      (o) =>
        (m.github && o.github && o.github.toLowerCase() === m.github.toLowerCase()) ||
        (m.email && o.email && o.email === m.email) ||
        (!m.github && !o.github && m.name && o.name && m.name.toLowerCase() === o.name.toLowerCase()),
    );
    if (same) {
      same.name ??= m.name;
      same.email ??= m.email;
      same.github ??= m.github;
      same.leader ||= m.leader;
    } else out.push({ ...m });
  }
  return out;
}

/** De-duplicates members, drops empty teams, numbers duplicate team names and adds warnings. */
export function finalise(teams: ExtractedTeam[]): ExtractedTeam[] {
  const seen = new Map<string, number>();
  return teams
    .map((t) => ({ ...t, members: dedupe(t.members).filter((m) => m.github || m.name) }))
    .filter((t) => t.members.length > 0)
    .map((t) => {
      const key = t.name.toLowerCase();
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const warnings = [...t.warnings];
      const leaders = t.members.filter((m) => m.leader);
      if (leaders.length > 1) {
        warnings.push("More than one lead marked; the first is used.");
        leaders.slice(1).forEach((m) => (m.leader = false));
      }
      const missing = t.members.filter((m) => !m.github);
      if (missing.length) warnings.push(`No GitHub found for ${missing.map((m) => m.name ?? m.email ?? "a member").join(", ")}.`);
      return { ...t, name: n > 1 ? `${t.name} (${n})` : t.name, warnings };
    });
}

/* ------------------------------------------------------------------ rows ------------------------------------------------------------------ */

type Field = "name" | "email" | "github" | "role";
interface Column {
  index: number;
  team?: true;
  slot?: "leader" | number | "self";
  field?: Field;
  multi?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[_*]/g, " ").replace(/\s+/g, " ").trim();
const LEADER_WORD = /\b(leader|lead|captain|head|poc|point of contact|spoc)\b/;
const MEMBER_SLOT = /\b(?:member|participant|teammate|person|student)\s*#?\s*(\d+)\b|\b(\d+)(?:st|nd|rd|th)?\s*(?:member|participant|teammate)\b/;

function classifyHeader(header: string, index: number): Column {
  const h = norm(header);
  const col: Column = { index };
  if (!h) return col;
  const isTeamName = /\bteam\b/.test(h) && /\b(name|title)\b/.test(h) && !LEADER_WORD.test(h) && !/\bmember/.test(h);
  if (isTeamName || /^(team|group|squad)( name)?$/.test(h) || /^(group|squad) name$/.test(h)) return { index, team: true };

  if (/git ?hub|\bgh\b/.test(h)) col.field = "github";
  else if (/e-?mail|mail id/.test(h)) col.field = "email";
  else if (/\brole\b|position|designation|are you (the )?(team )?lead/.test(h)) col.field = "role";
  else if (/\bname\b|^participant|^member|^teammate/.test(h)) col.field = "name";
  if (!col.field) return col;

  if (LEADER_WORD.test(h) && col.field !== "role") col.slot = "leader";
  else {
    const m = h.match(MEMBER_SLOT);
    if (m) col.slot = Number(m[1] ?? m[2]);
  }
  if (col.slot === undefined) {
    col.multi = /\b(members|participants|teammates|all|team)\b|profiles|links|handles|usernames|names|emails/.test(h);
    if (!col.multi) col.slot = "self";
  }
  return col;
}

function headerScore(row: string[]): number {
  return row.filter((c) => !/github\.com|https?:|@/i.test(c) && /team|name|git ?hub|e-?mail|member|leader|lead|participant|captain/i.test(c)).length;
}

const splitMulti = (v: string) =>
  v
    .split(/\r?\n|[,;|]|\s{2,}|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);

export function fromRows(rows: string[][]): Extraction | null {
  const trimmed = rows.map((r) => r.map((c) => (c ?? "").toString().trim())).filter((r) => r.some(Boolean));
  if (trimmed.length < 2) return null;
  let headerAt = -1;
  let best = 1;
  trimmed.slice(0, 10).forEach((r, i) => {
    const s = headerScore(r);
    if (s > best) {
      best = s;
      headerAt = i;
    }
  });
  if (headerAt < 0) return null;
  const columns = trimmed[headerAt]!.map(classifyHeader);
  const data = trimmed.slice(headerAt + 1);
  const teamCol = columns.find((c) => c.team);
  const slotted = columns.some((c) => c.slot === "leader" || typeof c.slot === "number" || c.multi);
  const selfCols = columns.filter((c) => c.slot === "self");

  // One person per row, grouped by team name.
  if (teamCol && !slotted && selfCols.length) {
    const byTeam = new Map<string, ExtractedTeam>();
    for (const row of data) {
      const teamName = row[teamCol.index]?.trim();
      if (!teamName) continue;
      const key = teamName.toLowerCase();
      if (!byTeam.has(key)) byTeam.set(key, { name: teamName, members: [], warnings: [] });
      const person: ExtractedMember = { name: null, email: null, github: null, leader: false };
      for (const c of selfCols) {
        const v = row[c.index] ?? "";
        if (c.field === "name") person.name = cleanName(v);
        if (c.field === "email") person.email = emailsIn(v)[0] ?? null;
        if (c.field === "github") person.github = handleFromCell(v);
        if (c.field === "role") person.leader = /lead|captain|head|yes|true|poc/i.test(v);
      }
      if (!person.github) person.github = githubHandles(row.join(" "))[0] ?? null;
      byTeam.get(key)!.members.push(person);
    }
    return { teams: finalise([...byTeam.values()]), method: "table", warnings: [] };
  }

  // One team per row.
  const teams: ExtractedTeam[] = [];
  data.forEach((row, i) => {
    const people = new Map<string, ExtractedMember>();
    const person = (slot: string) => {
      if (!people.has(slot)) people.set(slot, { name: null, email: null, github: null, leader: slot === "leader" });
      return people.get(slot)!;
    };
    const extraGithub: string[] = [];
    const multiNames: string[] = [];
    const multiEmails: string[] = [];
    const used = new Set<number>();
    for (const c of columns) {
      const v = row[c.index] ?? "";
      if (!v || c.team) continue;
      used.add(c.index);
      if (c.multi) {
        if (c.field === "github") extraGithub.push(...(githubHandles(v).length ? githubHandles(v) : splitMulti(v).map(handleFromCell).filter((x): x is string => !!x)));
        if (c.field === "name") multiNames.push(...splitMulti(v).map(cleanName).filter((x): x is string => !!x));
        if (c.field === "email") multiEmails.push(...emailsIn(v));
        continue;
      }
      if (c.slot === undefined) continue;
      const p = person(String(c.slot));
      if (c.field === "name") p.name = cleanName(v);
      if (c.field === "email") p.email = emailsIn(v)[0] ?? null;
      if (c.field === "github") p.github = handleFromCell(v);
      if (c.field === "role" && /lead|captain|yes|true/i.test(v)) p.leader = true;
    }
    // GitHub links in columns nobody recognised (e.g. "Profiles of all participants").
    row.forEach((v, idx) => {
      if (!used.has(idx) && !(teamCol && idx === teamCol.index)) extraGithub.push(...githubHandles(v));
    });

    const members = [...people.entries()]
      .sort(([a], [b]) => (a === "leader" ? -1 : b === "leader" ? 1 : Number(a) - Number(b)))
      .map(([, p]) => p);
    multiNames.forEach((name, k) => members.push({ name, email: multiEmails[k] ?? null, github: null, leader: false }));
    const withoutGithub = members.filter((m) => !m.github);
    for (const gh of extraGithub) {
      if (members.some((m) => m.github?.toLowerCase() === gh.toLowerCase())) continue;
      const slot = withoutGithub.shift();
      if (slot) slot.github = gh;
      else members.push({ name: null, email: null, github: gh, leader: false });
    }
    if (!members.length) return;
    const name = (teamCol && row[teamCol.index]?.trim()) || `Team ${i + 1}`;
    teams.push({ name, members, warnings: teamCol && !row[teamCol.index]?.trim() ? ["No team name given."] : [] });
  });
  return teams.length ? { teams: finalise(teams), method: "table", warnings: [] } : null;
}

/* ------------------------------------------------------------------ text ------------------------------------------------------------------ */

const TEAM_HEADER = /^\W{0,4}(?:\d+\s*[.)\]-]\s*)?team(?!\s*(?:lead|leader|member|members|size|captain|head|mate|mates|details)\b)\b(.*)$/i;
const LEADER_LINE = /\b(team\s*)?(leader|lead|captain|head|poc)\b/i;
/** Lines about the project or the institution, not a person. */
const NON_PERSON = /^\W{0,4}(project|repo|repository|demo|video|ppt|slides|presentation|idea|problem|track|theme|title|description|college|university|institute|school|city|state|country|abstract|tech\s*stack|domain|category|submission|website|deployed|live\s*link)\b/i;
const MEMBER_LINE = /^\W{0,4}(?:\d+\s*[.)]\s*)?(?:member|participant|teammate|student)\b|^\W{0,4}\d+\s*[.)]\s+\S/i;

function teamNameFromHeader(rest: string, n: number): string {
  const cleaned = rest
    .replace(/^\s*(?:name|title)?\s*(?:#?\s*\d+)?\s*[:\-–—.)]*\s*/i, "")
    .replace(/\s*[:\-–—]\s*$/, "")
    .trim();
  return cleaned || (rest.match(/\d+/) ? `Team ${rest.match(/\d+/)![0]}` : `Team ${n}`);
}

function parseBlock(lines: string[], fallbackName: string): ExtractedTeam {
  let name = fallbackName;
  const members: ExtractedMember[] = [];
  let current = null as ExtractedMember | null;
  const start = (leader: boolean) => {
    current = { name: null, email: null, github: null, leader };
    members.push(current);
    return current;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const teamName = line.match(/^\W{0,4}team\s*name\s*[:\-–—]\s*(.+)$/i);
    if (teamName) {
      name = teamName[1]!.trim();
      continue;
    }
    if (NON_PERSON.test(line)) continue;
    const handles = githubHandles(line);
    const emails = emailsIn(line);
    const isLeader = LEADER_LINE.test(line) && !/\bmember\b/i.test(line);
    const isMember = MEMBER_LINE.test(line);
    const label = cleanName(line);
    const onlyField = /^\W*(git\s*hub|e-?mail|mail|profile|phone|mobile|contact)\b/i.test(line);

    let p: ExtractedMember | null = current;
    if (isLeader || isMember) p = start(isLeader);
    else if (!p || (handles.length && p.github) || (emails.length && p.email && !handles.length) || (label && !onlyField && p.name && (p.github || p.email)))
      p = start(false);

    if (label && !onlyField && !p.name) p.name = label;
    if (emails[0] && !p.email) p.email = emails[0];
    if (handles[0] && !p.github) p.github = handles[0];
    for (const extra of handles.slice(1)) members.push({ name: null, email: null, github: extra, leader: false });
  }
  return { name, members: members.filter((m) => m.github || m.email || m.name), warnings: [] };
}

export function fromText(text: string): Extraction {
  const lines = text.replace(/\r/g, "").split("\n");
  const headers = lines.map((l, i) => ({ i, m: l.match(TEAM_HEADER) })).filter((h) => h.m && !/^\W{0,4}team\s*name\s*[:\-–—]/i.test(lines[h.i]!.trim()));
  const nameLines = lines.map((l, i) => ({ i, m: l.match(/^\W{0,4}team\s*name\s*[:\-–—]\s*(.+)$/i) })).filter((x) => x.m);

  let teams: ExtractedTeam[] = [];
  if (headers.length) {
    headers.forEach((h, k) => {
      const end = headers[k + 1]?.i ?? lines.length;
      teams.push(parseBlock(lines.slice(h.i + 1, end), teamNameFromHeader(h.m![1] ?? "", k + 1)));
    });
  } else if (nameLines.length) {
    nameLines.forEach((h, k) => {
      const end = nameLines[k + 1]?.i ?? lines.length;
      teams.push(parseBlock(lines.slice(h.i, end), `Team ${k + 1}`));
    });
  } else {
    // Blank-line separated blocks, or one team per line when a table was flattened.
    const blocks: string[][] = [];
    let cur: string[] = [];
    for (const l of lines) {
      if (l.trim()) cur.push(l);
      else if (cur.length) {
        blocks.push(cur);
        cur = [];
      }
    }
    if (cur.length) blocks.push(cur);
    const multiLine = blocks.filter((b) => b.length > 1 && githubHandles(b.join("\n")).length);
    if (multiLine.length >= 2) {
      teams = multiLine.map((b, k) => {
        const first = b[0]!.trim();
        const looksLikeTitle = !githubHandles(first).length && !emailsIn(first).length && first.length < 60;
        return parseBlock(looksLikeTitle ? b.slice(1) : b, looksLikeTitle ? first.replace(/[:\-–—]\s*$/, "") : `Team ${k + 1}`);
      });
    } else {
      const rowLines = lines.filter((l) => githubHandles(l).length);
      teams = rowLines.map((l, k) => {
        const cells = l.split(/\t|\s{2,}|\s\|\s|\|/).map((c) => c.trim()).filter(Boolean);
        const first = cells[0] ?? "";
        const title = !githubHandles(first).length && !emailsIn(first).length ? first : `Team ${k + 1}`;
        const members: ExtractedMember[] = [];
        let pending: string | null = null;
        for (const cell of cells.slice(title === first ? 1 : 0)) {
          const gh = githubHandles(cell);
          if (gh.length) {
            gh.forEach((g, gi) => members.push({ name: gi === 0 ? pending : null, email: null, github: g, leader: false }));
            pending = null;
          } else if (emailsIn(cell).length) {
            const last = members.at(-1);
            if (last && !last.email) last.email = emailsIn(cell)[0]!;
          } else pending = cleanName(cell) ?? pending;
        }
        return { name: title, members, warnings: [] };
      });
    }
  }
  return { teams: finalise(teams), method: "text", warnings: [] };
}

/** Rows first (when there are recognisable headers), then text. */
const withGithub = (e: Extraction | null) => (e ? e.teams.reduce((n, t) => n + t.members.filter((m) => m.github).length, 0) : 0);

/** Tries the table reading and the text reading and keeps whichever finds more GitHub accounts. */
export function extract(input: { rows?: string[][]; text?: string }): Extraction {
  const table = input.rows ? fromRows(input.rows) : null;
  const text = fromText(input.text || (input.rows ?? []).map((r) => r.join("  ")).join("\n"));
  if (table && table.teams.length && withGithub(table) >= withGithub(text)) return table;
  return text;
}

/** Applies the lead rule: an explicitly marked lead wins; otherwise the first listed member, or nobody. */
export function leaderOf(team: ExtractedTeam, policy: "first" | "equal"): number | null {
  const explicit = team.members.findIndex((m) => m.leader && m.github);
  if (explicit >= 0) return explicit;
  if (policy === "first") {
    const first = team.members.findIndex((m) => m.github);
    return first >= 0 ? first : null;
  }
  return null;
}
