import { NextResponse } from "next/server";
import { getJob, jobCounts, jobTeams, rankedTeams } from "@/lib/imports/jobs";

export const dynamic = "force-dynamic";

/** Live progress for one import: counts and every completed team, best first. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?since=<ms>: only teams finished after that time, so a live page polling a 5,000-team import stays light.
  const since = Math.max(0, Number(new URL(req.url).searchParams.get("since")) || 0);
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ranked = rankedTeams(id, since).map((t) => {
    const lead = t.leader !== null ? t.members[t.leader] : null;
    return {
      idx: t.idx,
      name: t.name,
      teamId: t.teamId,
      score: t.score,
      band: t.band,
      lead: lead ? { name: lead.name, github: lead.github } : null,
      members: t.members.filter((m) => m.github).map((m) => m.github!),
      warnings: t.warnings,
      finishedAt: t.finishedAt,
    };
  });
  const failed = jobTeams(id, "failed").map((t) => ({ idx: t.idx, name: t.name, error: t.error }));
  const running = jobTeams(id, "running").map((t) => t.name);
  return NextResponse.json(
    { job, counts: jobCounts(id), ranked, full: since === 0, failed, running, now: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
