import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { createOrExtendTeam, deleteTeam } from "../actions";
import { ActionButton, CreateTeam } from "@/components/forms";
import { Avatar, Band, Strip, StripLegend, fmt, relative } from "@/components/ui";
import { teamStandings } from "@/lib/standings";

const PAGE_SIZE = 100;

export const metadata: Metadata = { title: "Teams" };

/** Comma-separated search terms: "apex, nexora, @someone" finds every team matching any of them. */
function searchTerms(q: string): string[] {
  return q
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
}

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  await connection();
  const params = await searchParams;
  const { rows: all, firstAt, imports } = teamStandings();
  const teams = all.map((r) => r.team);
  const q = (params.q ?? "").slice(0, 500);
  const terms = searchTerms(q);
  // A team matches when any term is part of its name, its lead, or any member's username or name.
  const rows = terms.length
    ? all.filter(({ team, members }) => {
        const hay = [team.name, team.leader ?? "", ...members.map((m) => m.login), ...team.absent.map((a) => `${a.name ?? ""} ${a.github ?? ""}`)]
          .join("\n")
          .toLowerCase();
        return terms.some((t) => hay.includes(t));
      })
    : all;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (n: number) => `/teams?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

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
            <dd>{teams.reduce((s, t) => s + t.members.length + t.absent.length, 0)}</dd>
          </div>
        </dl>
      </header>

      <CreateTeam action={createOrExtendTeam} />

      {all.length > 0 && (
        <form className="team-search" action="/teams" method="get" role="search">
          <label className="sr-only" htmlFor="team-q">
            Search teams
          </label>
          <input
            id="team-q"
            className="input"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search teams — separate several with commas: apex, nexora, @username"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" type="submit">
            Search
          </button>
          <a className="btn ghost" href="/api/teams/export">
            Download full ranking CSV
          </a>
          {q && (
            <Link className="btn ghost" href="/teams">
              Clear
            </Link>
          )}
          {terms.length > 0 && (
            <p className="muted team-search-count">
              {rows.length} of {all.length} teams match {terms.length === 1 ? `“${terms[0]}”` : `${terms.length} searches`}. Ranks are overall ranks.
            </p>
          )}
        </form>
      )}

      {all.length > 0 && rows.length === 0 ? (
        <div className="empty-state">
          <h3>No team matches.</h3>
          <p>Try part of a team name, a lead or a member&rsquo;s username. Separate several searches with commas.</p>
        </div>
      ) : rows.length === 0 ? (
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
                <th scope="col" className="row-action">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ team, members, result, updated }, i) => {
                const rank = result ? (firstAt.get(result.total) ?? null) : null;
                const lead = team.leader ? members.find((m) => m.login.toLowerCase() === team.leader!.toLowerCase()) : null;
                const absentLead = team.leader ? team.absent.find((a) => a.label.toLowerCase() === team.leader!.toLowerCase()) : null;
                const size = members.length + team.absent.length;
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
                            {size === 1
                              ? "solo"
                              : team.mode === "equal" || (!lead && !absentLead)
                                ? "equal average"
                                : lead
                                  ? `lead @${lead.login}`
                                  : `lead ${absentLead!.name ?? absentLead!.github} (no usable GitHub)`}{" "}
                            · {size} {size === 1 ? "member" : "members"}
                            {team.jobId && imports.get(team.jobId) ? ` · from ${imports.get(team.jobId)}` : ""}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="hide-sm">
                      <span className="stack">
                        {members.slice(0, 6).map((m) => (
                          <Avatar key={m.login} login={m.login} src={m.profile?.avatarUrl} size="sm" />
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
                    <td className="hide-md">{result && <Strip dimensions={result.dimensions} i={i} />}</td>
                    <td className="right hide-sm muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {updated ? relative(updated) : relative(team.createdAt)}
                    </td>
                    <td className="row-action">
                      <ActionButton className="row-remove" action={deleteTeam.bind(null, team.id)} confirm={`Delete the team “${team.name}”? This can't be undone.`} busy="…">
                        <span aria-hidden="true">×</span>
                        <span className="sr-only">Delete {team.name}</span>
                      </ActionButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pages > 1 && (
            <nav className="pager" aria-label="Pages">
              {page > 1 && (
                <Link className="btn ghost small" href={pageHref(page - 1)}>
                  Previous
                </Link>
              )}
              <span className="mono muted">
                {page} / {pages}
              </span>
              {page < pages && (
                <Link className="btn ghost small" href={pageHref(page + 1)}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
