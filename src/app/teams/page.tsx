import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { createOrExtendTeam } from "../actions";
import { CreateTeam } from "@/components/forms";
import { Avatar, Band, Strip, StripLegend, fmt, relative } from "@/components/ui";
import { assessTeam } from "@/lib/scoring/team";
import { getProfiles, listTeams } from "@/lib/store";
import type { Dimension } from "@/lib/types";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage() {
  await connection();
  const teams = listTeams();
  const profiles = getProfiles([...new Set(teams.flatMap((t) => t.members.map((m) => m.login)))]);

  const rows = teams
    .map((team) => {
      const members = team.members.map((m) => ({ login: m.login, profile: profiles.get(m.login.toLowerCase()) ?? null }));
      const result = assessTeam(
        members.map((m) => ({ login: m.login, assessment: m.profile?.assessment ?? null })),
        team.leader,
        team.mode,
      );
      const updated = Math.max(0, ...members.map((m) => m.profile?.analyzedAt ?? 0));
      return { team, members, result, updated };
    })
    .sort((a, b) => (b.result?.total ?? -1) - (a.result?.total ?? -1) || a.team.name.localeCompare(b.team.name));

  return (
    <div className="wrap">
      <header className="page-head">
        <div>
          <p className="kicker">Team standings</p>
          <h1>Teams, weighted by role.</h1>
          <p className="lede">
            A team&rsquo;s score combines its members&rsquo; independent assessments. A solo team is 100% that person; with a lead, the lead carries 1.2× an
            equal share. Members can be added whenever they&rsquo;re ready.
          </p>
        </div>
        <dl className="stats">
          <div className="stat">
            <dt>Teams</dt>
            <dd>{teams.length}</dd>
          </div>
          <div className="stat">
            <dt>Members</dt>
            <dd>{teams.reduce((s, t) => s + t.members.length, 0)}</dd>
          </div>
        </dl>
      </header>

      <CreateTeam action={createOrExtendTeam} />

      {rows.length === 0 ? (
        <div className="empty-state">
          <h3>No teams yet.</h3>
          <p>Create one above. You can start with a single member and add the rest later; the score updates as people join.</p>
        </div>
      ) : (
        <div className="section" style={{ marginTop: 32 }}>
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Team</th>
                <th scope="col" className="hide-sm">
                  Members
                </th>
                <th scope="col" className="right">
                  Score
                </th>
                <th scope="col" className="hide-sm">
                  Band
                </th>
                <th scope="col" className="hide-md" aria-label="Weighted dimension scores">
                  <StripLegend />
                </th>
                <th scope="col" className="right hide-sm">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ team, members, result, updated }, i) => {
                const rank = result ? rows.findIndex((r) => r.result?.total === result.total) + 1 : null;
                const lead = team.leader ? members.find((m) => m.login.toLowerCase() === team.leader!.toLowerCase()) : null;
                return (
                  <tr key={team.id} style={{ ["--i" as string]: i }}>
                    <td className="rank">{rank ?? "—"}</td>
                    <td>
                      <div className="who">
                        <span className="names">
                          <Link className="primary" href={`/teams/${team.id}`}>
                            {team.name}
                          </Link>
                          <span className="secondary">
                            {members.length === 1 ? "solo" : team.mode === "equal" || !lead ? "equal average" : `lead @${lead.login}`} · {members.length}{" "}
                            {members.length === 1 ? "member" : "members"}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="hide-sm">
                      <span className="stack">
                        {members.slice(0, 6).map((m) => (
                          <Avatar key={m.login} login={m.login} src={m.profile?.evidence.avatarUrl} size="sm" />
                        ))}
                        {members.length > 6 && (
                          <span className="muted mono" style={{ fontSize: 12, marginLeft: 8, alignSelf: "center" }}>
                            +{members.length - 6}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="score-cell">{result ? fmt(result.total, 1) : "—"}</td>
                    <td className="hide-sm">{result ? <Band band={result.band} /> : <span className="muted">No members</span>}</td>
                    <td className="hide-md">{result && <Strip dimensions={result.dimensions as Dimension[]} i={i} />}</td>
                    <td className="right hide-sm muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {updated ? relative(updated) : relative(team.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
