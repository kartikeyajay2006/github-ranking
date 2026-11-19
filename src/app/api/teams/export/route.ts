import { jobTeams } from "@/lib/imports/jobs";
import { teamStandings } from "@/lib/standings";

export const dynamic = "force-dynamic";

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Quote every cell and neutralise spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

/** Download all current team standings in score order, including the member details from their source import. */
export async function GET() {
  const { rows, firstAt } = teamStandings();
  const sourceMembers = new Map<string, ReturnType<typeof jobTeams>[number]>();
  const jobs = new Set(rows.flatMap(({ team }) => (team.jobId ? [team.jobId] : [])));
  for (const jobId of jobs) {
    for (const imported of jobTeams(jobId)) {
      if (imported.teamId) sourceMembers.set(imported.teamId, imported);
    }
  }

  const lines = [[
    "Rank",
    "Team name",
    "Leader name",
    "Leader GitHub",
    "Member names",
    "Member GitHub usernames",
    "Total score",
  ].map(cell).join(",")];

  for (const { team, result } of rows) {
    const imported = sourceMembers.get(team.id);
    const importedMembers = imported?.members ?? [];
    const leaderMember = imported && imported.leader !== null ? importedMembers[imported.leader] : null;
    const leaderLogin = team.leader && !team.leader.startsWith("~") ? team.leader : null;
    const activeMembers = team.members.map(({ login }) => {
      const source = importedMembers.find((member) => member.github?.toLowerCase() === login.toLowerCase());
      return { name: source?.name?.trim() || `@${login}`, github: login };
    });
    const absentMembers = team.absent.map((member) => ({
      name: member.name?.trim() || (member.github ? `@${member.github}` : "Unknown member"),
      github: member.github,
    }));
    const members = [...activeMembers, ...absentMembers];
    const leadName = leaderMember?.name?.trim() || (leaderLogin ? `@${leaderLogin}` : team.absent.find((member) => member.label === team.leader)?.name) || "";
    const leadGithub = leaderMember?.github || leaderLogin || team.absent.find((member) => member.label === team.leader)?.github || "";

    lines.push([
      result ? firstAt.get(result.total) : "",
      team.name,
      leadName,
      leadGithub,
      members.map((member) => member.name).join("; "),
      members.map((member) => member.github ? `@${member.github}` : "").filter(Boolean).join("; "),
      result?.total.toFixed(1) ?? "",
    ].map(cell).join(","));
  }

  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="team-ranking.csv"',
      "Cache-Control": "no-store",
    },
  });
}
