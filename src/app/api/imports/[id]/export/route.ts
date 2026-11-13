import { getJob, jobTeams, rankedTeams } from "@/lib/imports/jobs";
import { isSelectable } from "@/lib/scoring/individual";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** The ranking as CSV: completed teams best first, then failed and unfinished ones. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return new Response("Not found", { status: 404 });
  const header = ["Rank", "Team", "Score", "Band", "Selected", "Lead name", "Lead GitHub", "Members (name @github)", "Member e-mails", "Status", "Notes"];
  const lines = [header.map(cell).join(",")];
  const describe = (t: ReturnType<typeof jobTeams>[number]) => [
    t.members.map((m) => `${m.name ?? ""}${m.github ? ` @${m.github}` : " (no GitHub)"}`.trim()).join("; "),
    t.members.map((m) => m.email).filter(Boolean).join("; "),
  ];
  rankedTeams(id).forEach((t, i) => {
    const lead = t.leader !== null ? t.members[t.leader] : null;
    const selected = !isSelectable(t.band) ? "no (insufficient)" : job.cutoff ? (i < job.cutoff ? "yes" : "no") : "";
    lines.push([i + 1, t.name, t.score?.toFixed(1), t.band, selected, lead?.name, lead?.github, ...describe(t), "ranked", t.warnings.join(" ")].map(cell).join(","));
  });
  for (const t of jobTeams(id).filter((x) => x.status !== "done")) {
    lines.push(["", t.name, "", "", "", "", "", ...describe(t), t.status, t.error ?? t.warnings.join(" ")].map(cell).join(","));
  }
  const filename = `${job.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "ranking"}.csv`;
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
