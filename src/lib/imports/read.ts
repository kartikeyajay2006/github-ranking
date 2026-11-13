import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { strFromU8, unzipSync } from "fflate";
import Papa from "papaparse";

export interface DocumentContent {
  rows?: string[][];
  text?: string;
  /** Plain text of the whole document, for AI extraction. */
  plain: string;
  label: string;
}

export class ReadError extends Error {}

export const MAX_BYTES = 25 * 1024 * 1024;

/* ------------------------------------------------------------------ formats ------------------------------------------------------------------ */

function csvRows(text: string, delimiter?: string): string[][] {
  return Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimiter }).data;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const columnIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Reads every worksheet of an .xlsx workbook (shared strings, inline strings, numbers); sheets are concatenated. */
export function xlsxRows(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name.startsWith("xl/worksheets/sheet") });
  } catch {
    throw new ReadError("This Excel file couldn't be opened. Save it as .xlsx or CSV and try again.");
  }
  const shared = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decodeXml([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
      )
    : [];
  const sheets = Object.keys(files)
    .filter((n) => n.startsWith("xl/worksheets/sheet"))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const rows: string[][] = [];
  for (const sheet of sheets) {
    const xml = strFromU8(files[sheet]!);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const body = c[2] ?? "";
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/t="(\w+)"/)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(body.match(/<v>(\d+)<\/v>/)?.[1])] ?? "";
        else if (type === "inlineStr") value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
        else value = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        const at = ref ? columnIndex(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      rows.push(cells);
    }
  }
  return rows;
}

/** Tables in an HTML document as rows of cell text. */
export function htmlTables(html: string): string[][] {
  const rows: string[][] = [];
  for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    for (const tr of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlText(c[1]!).replace(/\n+/g, "\n").trim());
      if (cells.some(Boolean)) rows.push(cells);
    }
  }
  return rows;
}

/** Visible text of an HTML fragment, keeping line structure and link targets (GitHub links are often only in href). */
export function htmlText(html: string): string {
  return decodeXml(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
        const text = inner.replace(/<[^>]+>/g, "");
        const target = href.replace(/^https?:\/\/www\.google\.com\/url\?q=([^&]+).*$/, (_m, q: string) => decodeURIComponent(q));
        return text.includes(target) || !/github\.com/i.test(target) ? text : `${text} ${target}`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|table|section)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[  ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

interface PdfItem {
  x: number;
  y: number;
  w: number;
  h: number;
  s: string;
}

/** Joins a cell's wrapped lines; e-mail addresses, URLs and hyphenated handles are re-joined without a space. */
export function joinWrapped(lines: string[]): string {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    const last = acc.split(/\s+/).pop() ?? "";
    const continues = /[@/:_-]$/.test(acc) || (/[@/]|\.[a-z]/i.test(last) && /^[\w.@/-]+$/.test(line.split(/\s+/)[0] ?? ""));
    return acc + (continues ? "" : " ") + line;
  }, "");
}

/**
 * Rebuilds tables from text positions: wrapped lines in one column become one cell, cells that overlap
 * vertically form a row, and each cell is placed in the column whose left edge it starts at.
 */
export function pdfTableRows(items: PdfItem[]): string[][] {
  if (!items.length) return [];
  // 1. Fragments: items on one baseline, split where the horizontal gap is wider than a word space.
  const byY = new Map<number, PdfItem[]>();
  for (const it of items) {
    const y = Math.round(it.y);
    const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 1.5) ?? y;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key)!.push(it);
  }
  type Frag = { x: number; end: number; top: number; bottom: number; h: number; s: string };
  const fragments: Frag[] = [];
  for (const [y, row] of byY) {
    row.sort((a, b) => a.x - b.x);
    let cur: Frag | null = null;
    for (const it of row) {
      const h = it.h || 10;
      const gap = cur ? it.x - cur.end : Infinity;
      if (cur && gap < Math.max(2.5, h * 0.33)) {
        cur.s += (gap > h * 0.12 && !cur.s.endsWith(" ") && !it.s.startsWith(" ") ? " " : "") + it.s;
        cur.end = it.x + it.w;
      } else {
        if (cur) fragments.push(cur);
        cur = { x: it.x, end: it.x + it.w, top: y + h, bottom: y, h, s: it.s };
      }
    }
    if (cur) fragments.push(cur);
  }
  // 2. Cells: a fragment directly below another and overlapping it horizontally continues the same (wrapped) cell.
  fragments.sort((a, b) => b.top - a.top || a.x - b.x);
  type Cell = { x: number; end: number; top: number; bottom: number; lines: string[] };
  const cells: Cell[] = [];
  for (const f of fragments) {
    const prev = cells.find(
      (c) => Math.min(c.end, f.end) - Math.max(c.x, f.x) > 0 && c.bottom - f.bottom > 0 && c.bottom - f.bottom <= f.h * 1.45,
    );
    if (prev) {
      prev.lines.push(f.s.trim());
      prev.bottom = f.bottom;
      prev.x = Math.min(prev.x, f.x);
      prev.end = Math.max(prev.end, f.end);
    } else cells.push({ x: f.x, end: f.end, top: f.top, bottom: f.bottom, lines: [f.s.trim()] });
  }
  // 3. Rows: cells whose vertical extents overlap.
  cells.sort((a, b) => b.top - a.top);
  const rows: Cell[][] = [];
  let band: { top: number; bottom: number; cells: Cell[] } | null = null;
  for (const c of cells) {
    if (band && c.top > band.bottom + 0.5) {
      band.cells.push(c);
      band.bottom = Math.min(band.bottom, c.bottom);
    } else {
      band = { top: c.top, bottom: c.bottom, cells: [c] };
      rows.push(band.cells);
    }
  }
  // 4. Columns: horizontal spans occupied by cells of multi-cell rows (titles spanning the page are ignored).
  const spans = rows
    .filter((r) => r.length > 1)
    .flat()
    .map((c) => [c.x, c.end] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const columns: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = columns.at(-1);
    if (last && a < last[1] - 0.5) last[1] = Math.max(last[1], b);
    else columns.push([a, b]);
  }
  if (!columns.length) return rows.map((r) => r.map((c) => joinWrapped(c.lines)));
  return rows.map((r) => {
    const out: string[] = new Array(columns.length).fill("");
    for (const c of r) {
      const mid = (c.x + c.end) / 2;
      let col = columns.findIndex(([a, b]) => mid >= a - 2 && mid <= b + 2);
      if (col < 0) col = columns.reduce((best, [a, b], i) => (Math.abs((a + b) / 2 - mid) < Math.abs((columns[best]![0] + columns[best]![1]) / 2 - mid) ? i : best), 0);
      out[col] = (out[col] ? out[col] + " " : "") + joinWrapped(c.lines);
    }
    return out;
  });
}

async function pdfContent(bytes: Uint8Array): Promise<{ text: string; rows: string[][] }> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new ReadError("This PDF couldn't be opened. It may be encrypted or damaged.");
  }
  const pages: string[] = [];
  const rows: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const item of content.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      if (!item.str?.trim()) continue;
      items.push({ x: item.transform[4]!, y: item.transform[5]!, w: item.width, h: item.height || Math.abs(item.transform[3]!) || 10, s: item.str });
    }
    rows.push(...pdfTableRows(items));
    // Plain lines (for documents written as paragraphs): items sharing a baseline, wide gaps kept as cell breaks.
    const lines = new Map<number, PdfItem[]>();
    for (const it of items) {
      const y = Math.round(it.y / 3) * 3;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push(it);
    }
    pages.push(
      [...lines.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, row]) => {
          row.sort((a, b) => a.x - b.x);
          let out = "";
          let end = -Infinity;
          for (const it of row) {
            out += (out ? (it.x - end > 12 ? "   " : it.x - end > 1 ? " " : "") : "") + it.s;
            end = it.x + it.w;
          }
          return out;
        })
        .join("\n"),
    );
  }
  const text = pages.join("\n\n");
  if (text.replace(/\s/g, "").length < 20) throw new ReadError("This PDF has no selectable text (it may be a scan). Export the source document instead, or paste its text.");
  return { text, rows };
}

/** Markdown / pipe tables ("| Team | Lead |") as rows. */
export function pipeRows(text: string): string[][] | null {
  const lines = text.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (lines.length < 2) return null;
  return lines
    .filter((l) => !/^[\s|:\-]+$/.test(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
}

/** JSON exports: a flat array of records becomes rows; nested team objects become "Team:" text blocks. */
export function jsonContent(value: unknown): { rows?: string[][]; text: string } {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (Object.values(value).find((v) => Array.isArray(v) && v.some((x) => x && typeof x === "object")) as unknown[] | undefined)
      : undefined;
  if (!list?.length) return { text: JSON.stringify(value, null, 1) };
  const objects = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  const flat = objects.every((o) => Object.values(o).every((v) => v === null || typeof v !== "object"));
  if (flat) {
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    return { rows: [keys, ...objects.map((o) => keys.map((k) => (o[k] === null || o[k] === undefined ? "" : String(o[k]))))], text: "" };
  }
  const render = (v: unknown): string =>
    v === null || v === undefined ? "" : typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => (typeof x === "object" ? render(x) : `${k} ${x}`)).join(", ") : String(v);
  const blocks = objects.map((o, i) => {
    const nameKey = Object.keys(o).find((k) => /team.*name|^team$|^name$|title/i.test(k) && typeof o[k] === "string");
    const lines = [`Team: ${nameKey ? String(o[nameKey]) : `Team ${i + 1}`}`];
    for (const [k, v] of Object.entries(o)) {
      if (k === nameKey) continue;
      const label = /lead|captain|head/i.test(k) ? "Leader" : "Member";
      if (Array.isArray(v)) for (const item of v) lines.push(`${label}: ${render(item)}`);
      else if (v && typeof v === "object") lines.push(`${label}: ${render(v)}`);
      else if (typeof v === "string" && /github|@/.test(v)) lines.push(`${label}: ${v}`);
    }
    return lines.join("\n");
  });
  return { text: blocks.join("\n\n") };
}

async function docxContent(bytes: Uint8Array): Promise<{ rows?: string[][]; text: string }> {
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(bytes);
  try {
    const [{ value: html }, { value: raw }] = await Promise.all([mammoth.convertToHtml({ buffer }), mammoth.extractRawText({ buffer })]);
    const rows = htmlTables(html);
    return { rows: rows.length > 1 ? rows : undefined, text: htmlText(html) || raw };
  } catch {
    throw new ReadError("This Word document couldn't be opened. Save it as .docx and try again.");
  }
}

function sniff(bytes: Uint8Array): "pdf" | "zip" | "ole" | "text" {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return "ole";
  return "text";
}

function zipKind(bytes: Uint8Array): "xlsx" | "docx" | null {
  try {
    const names = Object.keys(unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "word/document.xml" }));
    return names.includes("xl/workbook.xml") ? "xlsx" : names.includes("word/document.xml") ? "docx" : null;
  } catch {
    return null;
  }
}

/** Reads any supported document from bytes, using the name and content type only as hints. */
export async function readBytes(bytes: Uint8Array, name: string, contentType = ""): Promise<DocumentContent> {
  if (bytes.byteLength > MAX_BYTES) throw new ReadError("Files are limited to 25 MB.");
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const kind = sniff(bytes);
  const label = name;

  if (kind === "pdf") {
    const { text, rows } = await pdfContent(bytes);
    return { rows: rows.length > 1 ? rows : undefined, text, plain: text, label };
  }
  if (kind === "zip") {
    const z = zipKind(bytes);
    if (z === "xlsx") {
      const rows = xlsxRows(bytes);
      return { rows, plain: rows.map((r) => r.join("\t")).join("\n"), label };
    }
    if (z === "docx") {
      const d = await docxContent(bytes);
      return { rows: d.rows, text: d.text, plain: d.text, label };
    }
    throw new ReadError("This file couldn't be opened. It may be damaged, or it's an archive rather than a document. Upload a PDF, Word (.docx), Excel (.xlsx), CSV or text file.");
  }
  if (kind === "ole") throw new ReadError("Old .doc/.xls formats aren't supported. Save as .docx, .xlsx or CSV.");

  const text = new TextDecoder("utf-8").decode(bytes);
  if (ext === "csv" || /text\/csv/.test(contentType)) {
    const rows = csvRows(text);
    return { rows, plain: text, label };
  }
  if (ext === "tsv" || /tab-separated/.test(contentType)) {
    const rows = csvRows(text, "\t");
    return { rows, plain: text, label };
  }
  if (ext === "html" || ext === "htm" || /text\/html/.test(contentType) || /^\s*<(!doctype|html)/i.test(text)) {
    const rows = htmlTables(text);
    const plain = htmlText(text);
    return { rows: rows.length > 1 ? rows : undefined, text: plain, plain, label };
  }
  if (ext === "json" || /application\/json/.test(contentType) || /^\s*[[{]/.test(text)) {
    try {
      const j = jsonContent(JSON.parse(text));
      return { rows: j.rows, text: j.text, plain: text, label };
    } catch {
      /* not JSON after all: fall through to text */
    }
  }
  const pipes = pipeRows(text);
  if (pipes) return { rows: pipes, text, plain: text, label };
  // Text that is really a CSV with a header row.
  const firstLine = text.split("\n", 1)[0] ?? "";
  if ((firstLine.match(/,/g)?.length ?? 0) >= 2 && /team|name|github/i.test(firstLine)) return { rows: csvRows(text), plain: text, label };
  return { text, plain: text, label };
}

/* ------------------------------------------------------------------- links ------------------------------------------------------------------- */

/** Rewrites Google Docs / Sheets / Drive share links to their public export URLs. */
export function exportUrl(input: string): { url: string; hint: string } {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new ReadError("That doesn't look like a link.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new ReadError("Only http and https links are supported.");
  const id = u.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/)?.[1];
  if (u.hostname === "docs.google.com" && id) {
    if (u.pathname.startsWith("/spreadsheets/")) {
      const gid = u.hash.match(/gid=(\d+)/)?.[1] ?? u.searchParams.get("gid");
      return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`, hint: "sheet.csv" };
    }
    if (u.pathname.startsWith("/document/")) return { url: `https://docs.google.com/document/d/${id}/export?format=html`, hint: "document.html" };
    if (u.pathname.startsWith("/presentation/")) return { url: `https://docs.google.com/presentation/d/${id}/export/txt`, hint: "slides.txt" };
  }
  if (u.hostname === "docs.google.com" && u.pathname.startsWith("/forms/"))
    throw new ReadError("A Google Form link doesn't expose responses. Open the form's linked response sheet and share that link instead.");
  if (u.hostname === "drive.google.com") {
    const fileId = id ?? u.searchParams.get("id");
    if (fileId) return { url: `https://drive.google.com/uc?export=download&id=${fileId}`, hint: "drive-file" };
  }
  return { url: u.toString(), hint: u.pathname.split("/").pop() || "download" };
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v === "::" || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new ReadError("Links to private addresses aren't allowed.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new ReadError(`Couldn't resolve ${host}.`);
  if (addresses.some((a) => privateAddress(a.address))) throw new ReadError("Links to private addresses aren't allowed.");
}

/** Downloads a shared document. Redirects are followed by hand so each hop is checked against private addresses. */
export async function readLink(input: string): Promise<DocumentContent> {
  const { url, hint } = exportUrl(input);
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "github-ranking" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, current);
      if (/accounts\.google\.com|ServiceLogin/.test(next.toString()))
        throw new ReadError("This link isn't public. In Google, set sharing to “Anyone with the link can view” and try again.");
      current = next;
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new ReadError("The link refused access. Make it viewable by anyone with the link, or upload the file instead.");
    if (res.status === 404 || res.status === 410)
      throw new ReadError(
        /google\.com$/.test(current.hostname)
          ? "Google couldn't find that document. Check the link, and that sharing is set to “Anyone with the link can view”."
          : "Nothing was found at that link (404). Check that it's correct and public.",
      );
    if (!res.ok) throw new ReadError(`The link returned an error (${res.status}).`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new ReadError("Linked files are limited to 25 MB.");
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    const disposition = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
    const name = disposition ? decodeURIComponent(disposition) : hint;
    const doc = await readBytes(bytes, name, type);
    if (/accounts\.google\.com/.test(doc.plain.slice(0, 4000)) && /sign in/i.test(doc.plain.slice(0, 4000)))
      throw new ReadError("This link isn't public. In Google, set sharing to “Anyone with the link can view” and try again.");
    return { ...doc, label: input.length > 80 ? `${input.slice(0, 77)}…` : input };
  }
  throw new ReadError("Too many redirects.");
}
