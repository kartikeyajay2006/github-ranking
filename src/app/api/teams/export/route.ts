import { jobTeams } from "@/lib/imports/jobs";
import { teamStandings } from "@/lib/standings";
import { enrichRegistrationRoster } from "@/lib/imports/source-roster";

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
    "Leader email",
    "Member names",
    "Member GitHub usernames",
    "Member emails",
    "College by member",
    "Total score",
  ].map(cell).join(",")];

  for (const { team, result } of rows) {
    const imported = sourceMembers.get(team.id);
    const importedMembers = imported?.members ?? [];
    const leaderLogin = team.leader && !team.leader.startsWith("~") ? team.leader : null;
    const rosterReferences = importedMembers.length
      ? importedMembers.map((member, index) => ({
          name: member.name,
          github: member.github,
          email: member.email,
          college: member.college ?? null,
          leader: imported?.leader === index || member.leader,
        }))
      : [
          ...team.members.map(({ login }) => ({
            name: null,
            github: login,
            email: null,
            college: null,
            leader: login.toLowerCase() === team.leader?.toLowerCase(),
          })),
          ...team.absent.map((member) => ({
            name: member.name,
            github: member.github,
            email: null,
            college: null,
            leader: member.label.toLowerCase() === team.leader?.toLowerCase(),
          })),
        ];
    const registrationMembers = await enrichRegistrationRoster(team.name, rosterReferences);
    const leaderMember = imported && imported.leader !== null ? registrationMembers[imported.leader] : registrationMembers.find((member) => member.leader);
    const sourceFor = (github: string | null | undefined, name: string | null | undefined) =>
      registrationMembers.find((member) => github && member.github?.toLowerCase() === github.toLowerCase()) ??
      registrationMembers.find((member) => name && member.name?.trim().toLowerCase() === name.trim().toLowerCase());
    const activeMembers = team.members.map(({ login }) => {
      const source = sourceFor(login, null);
      return {
        name: source?.name?.trim() || `@${login}`,
        github: login,
        email: source?.email ?? null,
        college: source?.college ?? null,
        isLeader: login.toLowerCase() === team.leader?.toLowerCase() || (!!source && source === leaderMember),
      };
    });
    const absentMembers = team.absent.map((member) => {
      const source = sourceFor(member.github, member.name);
      return {
        name: source?.name?.trim() || member.name?.trim() || (member.github ? `@${member.github}` : "Unknown member"),
        github: member.github ?? source?.github ?? null,
        email: source?.email ?? null,
        college: source?.college ?? null,
        isLeader: member.label.toLowerCase() === team.leader?.toLowerCase() || (!!source && source === leaderMember),
      };
    });
    const members = [...activeMembers, ...absentMembers];
    const activeLead = members.find((member) => team.leader && member.github?.toLowerCase() === team.leader.toLowerCase());
    const absentLead = team.absent.find((member) => team.leader && member.label.toLowerCase() === team.leader.toLowerCase());
    const leadSource = (leaderMember?.github ? sourceFor(leaderMember.github, leaderMember.name) : null) ?? sourceFor(leaderLogin, absentLead?.name);
    const leadName = leadSource?.name?.trim() || leaderMember?.name?.trim() || activeLead?.name || (leaderLogin ? `@${leaderLogin}` : absentLead?.name) || "";
    const leadGithub = leaderMember?.github || leaderLogin || team.absent.find((member) => member.label === team.leader)?.github || "";
    const leadEmail = leadSource?.email ?? activeLead?.email ?? "";
    const otherMembers = members.filter((member) => !member.isLeader);
    const colleges = members.flatMap((member) => member.college ? [`${member.name}: ${member.college}`] : []);

    lines.push([
      result ? firstAt.get(result.total) : "",
      team.name,
      leadName,
      leadGithub,
      leadEmail,
      members.map((member) => member.name).join("; "),
      members.map((member) => member.github ? `@${member.github}` : "").filter(Boolean).join("; "),
      otherMembers.flatMap((member) => member.email ? [`${member.name}: ${member.email}`] : []).join("; "),
      colleges.join("; "),
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
