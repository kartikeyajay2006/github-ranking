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
  /** The link they gave for their best project (a GitHub repository is graded; other links are kept for reference). */
  project?: string | null;
  /** Marked withdrawn / cancelled in the source. Left out of ranking by default. */
  withdrawn?: boolean;
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

/**
 * A cell that is supposed to hold a GitHub account: profile URL, @handle or bare handle. In such a cell a
 * repository link or a GitHub Pages address still identifies its owner.
 */
export function handleFromCell(value: string): string | null {
  const found = githubHandles(value);
  if (found.length) return found[0]!;
  const repoOwner = value.match(/github\.com\/([A-Za-z0-9-]{1,39})\/[A-Za-z0-9_.-]+/i)?.[1];
  if (repoOwner && isLogin(repoOwner)) return repoOwner;
  const pages = value.match(/(?:^|\/\/|\s)([A-Za-z0-9-]{1,39})\.github\.io\b/i)?.[1];
  if (pages && isLogin(pages)) return pages;
  const bare = value.trim().replace(/^@/, "").replace(/\/$/, "");
  return bare && !/\s/.test(bare) && isLogin(bare) ? bare : null;
}

/** The best-project link in a cell: the first GitHub repository if there is one, otherwise the first link. */
export function projectLink(value: string): string | null {
  const v = value.trim();
  if (!v || /^(n\/?a|na|none|nil|-|no|not yet|nothing)$/i.test(v)) return null;
  const repo = v.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]+[^\s,;|)\]"'<>]*/i)?.[0];
  if (repo) return repo.startsWith("http") ? repo : `https://${repo}`;
  const url = v.match(/https?:\/\/[^\s,;|)\]"'<>]+/i)?.[0] ?? v.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|app|dev|tech|in|me|org|net|ai|site|xyz|co)\b[^\s,;|)\]"'<>]*/i)?.[0];
  return url ? (url.startsWith("http") ? url : `https://${url}`) : null;
}

const WITHDRAWN = /\b(withdrawn|withdrew|cancell?ed|rejected|dropped|disqualified|left|removed|inactive)\b/i;

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

const lower = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null);
const sameName = (a: ExtractedMember, b: ExtractedMember) => !!a.name && !!b.name && lower(a.name) === lower(b.name);

/**
 * Merges rows that are the same person (same e-mail; or same GitHub with no conflicting name or e-mail; or
 * the same name with no GitHub). Two different people who typed the same GitHub are kept apart: the first
 * keeps it, the other is treated as having no usable GitHub, and the team is warned.
 */
function dedupe(members: ExtractedMember[], warnings: string[]): ExtractedMember[] {
  const out: ExtractedMember[] = [];
  for (const raw of members) {
    const m = { ...raw };
    const same = out.find((o) => {
      if (m.email && o.email) return o.email === m.email;
      if (m.github && o.github && lower(o.github) === lower(m.github)) return !m.name || !o.name || sameName(o, m) || !m.email || !o.email;
      return !m.github && !o.github && sameName(o, m);
    });
    if (same) {
      same.name ??= m.name;
      same.email ??= m.email;
      same.github ??= m.github;
      same.project ??= m.project;
      same.leader ||= m.leader;
      // Listed twice, once active and once withdrawn: they are active.
      same.withdrawn = !!same.withdrawn && !!m.withdrawn;
      continue;
    }
    const clash = m.github ? out.find((o) => lower(o.github) === lower(m.github)) : undefined;
    if (clash) {
      warnings.push(`${m.name ?? m.email ?? "A member"} gave the same GitHub as ${clash.name ?? clash.email ?? "a teammate"} (@${m.github}); it is kept for ${clash.name ?? "the first"} only.`);
      m.github = null;
    }
    out.push(m);
  }
  return out;
}

const teamKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
const active = (m: ExtractedMember) => !m.withdrawn;
export const isWithdrawnTeam = (t: ExtractedTeam) => t.members.length > 0 && t.members.every((m) => m.withdrawn);

/**
 * De-duplicates members, drops empty teams, tells apart different teams with the same name, and flags
 * people who appear in more than one active team.
 */
export function finalise(teams: ExtractedTeam[]): ExtractedTeam[] {
  const cleaned = teams
    .map((t) => {
      const warnings = [...t.warnings];
      return { ...t, members: dedupe(t.members, warnings).filter((m) => m.github || m.name || m.email), warnings };
    })
    .filter((t) => t.members.length > 0);

  // Same name, different people: each team keeps its name plus its lead ("Apex · Bhargav S"), falling back
  // to a number when the lead has no name, so they can be told apart everywhere (and in the CSV).
  const groups = new Map<string, number[]>();
  cleaned.forEach((t, i) => groups.set(teamKey(t.name), [...(groups.get(teamKey(t.name)) ?? []), i]));
  const label = (t: ExtractedTeam) => {
    const lead = t.members.find((m) => m.leader) ?? t.members[0];
    return lead?.name ?? (lead?.github ? `@${lead.github}` : null);
  };
  const used = new Set<string>();
  const named = cleaned.map((t, i) => {
    const group = groups.get(teamKey(t.name))!;
    const warnings = [...t.warnings];
    let name = t.name;
    if (group.length > 1) {
      const lead = label(t);
      name = lead ? `${t.name} · ${lead}` : t.name;
      let n = group.indexOf(i) + 1;
      while (used.has(name.toLowerCase())) name = `${t.name} (${++n})`;
      const others = group.filter((j) => j !== i).map((j) => label(cleaned[j]!) ?? "no lead named");
      warnings.push(`${group.length} different teams are called “${t.name}” (also led by ${others.join(", ")}); shown with the lead's name.`);
    }
    used.add(name.toLowerCase());
    const leaders = t.members.filter((m) => m.leader);
    if (leaders.length > 1) {
      warnings.push("More than one lead marked; the first is used.");
      leaders.slice(1).forEach((m) => (m.leader = false));
    }
    const missing = t.members.filter((m) => active(m) && !m.github);
    if (missing.length) warnings.push(`No GitHub found for ${missing.map((m) => m.name ?? m.email ?? "a member").join(", ")}.`);
    const gone = t.members.filter((m) => m.withdrawn);
    if (gone.length && gone.length < t.members.length) warnings.push(`Withdrawn: ${gone.map((m) => m.name ?? m.github ?? "a member").join(", ")}.`);
    return { ...t, name, warnings };
  });

  // The same person (GitHub or e-mail) in more than one active team.
  const where = new Map<string, Set<number>>();
  named.forEach((t, i) => {
    if (isWithdrawnTeam(t)) return;
    for (const m of t.members.filter(active)) {
      for (const k of [m.github && `gh:${lower(m.github)}`, m.email && `em:${m.email}`]) {
        if (!k) continue;
        if (!where.has(k)) where.set(k, new Set());
        where.get(k)!.add(i);
      }
    }
  });
  named.forEach((t, i) => {
    if (isWithdrawnTeam(t)) return;
    const notes = new Set<string>();
    for (const m of t.members.filter(active)) {
      const teamsOf = new Set([...(m.github ? where.get(`gh:${lower(m.github)}`) ?? [] : []), ...(m.email ? where.get(`em:${m.email}`) ?? [] : [])]);
      teamsOf.delete(i);
      if (teamsOf.size) notes.add(`${m.github ? `@${m.github}` : (m.name ?? m.email)} is also in ${[...teamsOf].map((j) => `“${named[j]!.name}”`).join(", ")}.`);
    }
    t.warnings.push(...notes);
  });
  return named;
}

/* ------------------------------------------------------------------ rows ------------------------------------------------------------------ */

type Field = "name" | "email" | "github" | "role" | "project" | "status";
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

  if (/\b(best )?project\b|\brepo(sitory)?\b/.test(h) && !/\bprofile\b/.test(h) && !/solution|document|drive|video|ppt|presentation|idea|title|name|description|track/.test(h)) col.field = "project";
  else if (/^(status|registration status|application status|participation status|state)$/.test(h)) col.field = "status";
  else if (/git ?hub|\bgh\b/.test(h)) col.field = "github";
  else if (/e-?mail|mail id/.test(h)) col.field = "email";
  else if (/\brole\b|position|designation|are you (the )?(team )?lead/.test(h)) col.field = "role";
  else if (/\bname\b|^participant|^member|^teammate/.test(h)) col.field = "name";
  if (!col.field) return col;

  if (col.field === "status") {
    col.slot = "self";
    return col;
  }
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

  // One person per row, grouped by team.
  if (teamCol && !slotted && selfCols.length) {
    const projectCols = selfCols.filter((c) => c.field === "project");
    const blocks: { key: string; name: string; members: ExtractedMember[] }[] = [];
    for (const row of data) {
      const teamName = row[teamCol.index]?.trim().replace(/\s+/g, " ");
      if (!teamName) continue;
      const person: ExtractedMember = { name: null, email: null, github: null, leader: false };
      for (const c of selfCols) {
        const v = row[c.index] ?? "";
        if (c.field === "name") person.name = cleanName(v);
        if (c.field === "email") person.email = emailsIn(v)[0] ?? null;
        if (c.field === "github") person.github = handleFromCell(v);
        if (c.field === "role") person.leader = /lead|captain|head|yes|true|poc/i.test(v);
        if (c.field === "status" && WITHDRAWN.test(v)) person.withdrawn = true;
        if (c.field === "project" && !person.project) person.project = projectLink(v);
      }
      if (!person.github) {
        const elsewhere = row.filter((_, i) => !projectCols.some((c) => c.index === i)).join(" ");
        person.github = githubHandles(elsewhere)[0] ?? null;
      }
      if (projectCols.length && person.project === undefined) person.project = null;
      // A new team starts when the team name changes, or at a second lead under the same name.
      const last = blocks.at(-1);
      const key = teamKey(teamName);
      if (last && last.key === key && !(person.leader && last.members.some((m) => m.leader))) last.members.push(person);
      else blocks.push({ key, name: teamName, members: [person] });
    }
    // Rows of one team that are scattered through the sheet are joined, unless both parts have their
    // own lead: then they are different teams with the same name, or the same team registered twice
    // (same lead), which is merged.
    const merged: typeof blocks = [];
    for (const b of blocks) {
      const lead = b.members.find((m) => m.leader);
      const into = merged.find((m) => {
        if (m.key !== b.key) return false;
        const other = m.members.find((x) => x.leader);
        if (!lead || !other) return true;
        return (!!lead.email && lead.email === other.email) || (!!lead.github && lower(lead.github) === lower(other.github));
      });
      if (into) into.members.push(...b.members);
      else merged.push({ ...b, members: [...b.members] });
    }
    return { teams: finalise(merged.map((b) => ({ name: b.name, members: b.members, warnings: [] }))), method: "table", warnings: [] };
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
