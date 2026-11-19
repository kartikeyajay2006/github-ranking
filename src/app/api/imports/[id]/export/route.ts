import { getJob, jobTeams, rankedTeams } from "@/lib/imports/jobs";
import { isSelectable } from "@/lib/scoring/individual";
import { personScore } from "@/lib/scoring/project";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** The competition ranking as CSV: one ranked team per row, then failed and unfinished teams. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return new Response("Not found", { status: 404 });
  const w = Math.round(job.projectWeight * 100);
  const weighting = w ? `${100 - w}% GitHub + ${w}% best project${job.projectMissing === "github" ? " (GitHub only without a gradable project)" : " (missing project = 0)"}` : "GitHub only";
  const header = [
    "Rank",
    "Team, leader & members",
    "Overall team score",
    "Leader email",
    "Other members' emails",
    "Other members' colleges",
    "Band",
    "Selected",
    "GitHub score",
    "Best project score",
    "Best project links",
    "Member score components (GitHub / best project)",
    "Status",
    "Notes",
  ];
  header.push("Scoring");
  const lines = [header.map(cell).join(",")];
  const roster = (t: ReturnType<typeof jobTeams>[number]) => {
    const findScore = (member: (typeof t.members)[number], index: number) => {
      const breakdown = t.breakdown ?? [];
      const score = index === t.leader
        ? breakdown.find((m) => m.isLeader)
        : member.github
          ? breakdown.find((m) => m.login?.toLowerCase() === member.github!.toLowerCase() || m.label.toLowerCase() === member.github!.toLowerCase())
          : breakdown.find((m) => !m.login && [member.name, member.email].some((value) => value && (m.name?.toLowerCase() === value.toLowerCase() || m.label.replace(/^~/, "").toLowerCase() === value.toLowerCase())));
      return score ? personScore(score.github, score.project, job.projectWeight, job.projectMissing).toFixed(1) : "—";
    };
    const describe = (member: (typeof t.members)[number], index: number) => {
      const identity = `${member.name?.trim() || "Unnamed"}${member.github ? ` (@${member.github})` : " (no GitHub)"}`;
      return `${identity} — ${findScore(member, index)}`;
    };
    const lead = t.leader !== null ? t.members[t.leader] : null;
    const members = t.members.map((member, index) => ({ member, index })).filter(({ index }) => index !== t.leader);
    return [
      `Team: ${t.name}`,
      lead ? `Leader: ${describe(lead, t.leader!)}` : "Leader: not designated",
      ...(members.length ? ["Members:", ...members.map(({ member, index }) => `• ${describe(member, index)}`)] : []),
    ].join("\n");
  };
  const memberComponents = (t: ReturnType<typeof jobTeams>[number]) => (t.breakdown ?? [])
    .map((member) => `${member.name ?? member.login ?? member.label.replace(/^~/, "")}: ${member.github.toFixed(1)} / ${member.project === null ? "—" : member.project.toFixed(1)}${member.projectRepo ? ` (${member.projectRepo})` : member.projectNote ? ` (${member.projectNote})` : ""}`)
    .join("; ");
  const leadMember = (t: ReturnType<typeof jobTeams>[number]) => t.leader !== null ? t.members[t.leader] : null;
  const leaderEmail = (t: ReturnType<typeof jobTeams>[number]) => leadMember(t)?.email ?? "";
  const memberEmails = (t: ReturnType<typeof jobTeams>[number]) => t.members
    .filter((_member, index) => index !== t.leader)
    .map((member) => member.email)
    .filter(Boolean)
    .join("; ");
  const colleges = (t: ReturnType<typeof jobTeams>[number]) => t.members
    .flatMap((member, index) => index !== t.leader && member.college?.trim() ? [`${member.name?.trim() || "Member"}: ${member.college.trim()}`] : [])
    .join("; ");
  const projects = (t: ReturnType<typeof jobTeams>[number]) => t.members.map((m) => m.project).filter(Boolean).join("; ");
  rankedTeams(id).forEach((t, i) => {
    const selected = !isSelectable(t.band) ? "no (insufficient)" : job.cutoff ? (i < job.cutoff ? "yes" : "no") : "";
    lines.push(
      [i + 1, roster(t), t.score?.toFixed(1), leaderEmail(t), memberEmails(t), colleges(t), t.band, selected, t.githubScore?.toFixed(1), t.projectScore?.toFixed(1), projects(t), memberComponents(t), "ranked", t.warnings.join(" "), weighting]
        .map(cell)
        .join(","),
    );
  });
  for (const t of jobTeams(id).filter((x) => x.status !== "done")) {
    lines.push(["", roster(t), "", leaderEmail(t), memberEmails(t), colleges(t), "", "", "", "", projects(t), memberComponents(t), t.status, t.error ?? t.warnings.join(" "), weighting].map(cell).join(","));
  }
  const filename = `${job.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "ranking"}.csv`;
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
