import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listBackups } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** Liveness and storage status, for uptime monitors and the deploy script. No personal data. */
export async function GET() {
  try {
    const conn = db();
    const n = (t: string) => (conn.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const running = (conn.prepare("SELECT COUNT(*) AS n FROM import_jobs WHERE status = 'running'").get() as { n: number }).n;
    const latest = listBackups()[0];
    return NextResponse.json(
      {
        ok: true,
        profiles: n("profiles"),
        teams: n("teams"),
        imports: n("import_jobs"),
        runningImports: running,
        lastBackup: latest ? new Date(latest.at).toISOString() : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
