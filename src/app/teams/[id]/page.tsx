import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { addTeamMembers, deleteTeam, refreshTeam, removeTeamMember, renameTeam, setTeamLeader, setTeamMode } from "@/app/actions";
import { ActionButton, AddMembers, RenameTeam } from "@/components/forms";
import { Avatar, Band, Meter, fmt, pct, relative, seriesColor } from "@/components/ui";
import { LEADER_FACTOR, assessTeam } from "@/lib/scoring/team";
import { getProfiles, getTeam } from "@/lib/store";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ skipped?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const team = getTeam((await params).id);
  return { title: team?.name ?? "Team" };
}

export default async function TeamPage({ params, searchParams }: Props) {
  await connection();
  const { id } = await params;
  const { skipped } = await searchParams;
  const team = getTeam(id);
  if (!team) notFound();

  const profiles = getProfiles(team.members.map((m) => m.login));
  const members = team.members.map((m) => ({ ...m, profile: profiles.get(m.login.toLowerCase()) ?? null }));
  const result = assessTeam(
    members.map((m) => ({ login: m.login, assessment: m.profile?.assessment ?? null })),
    team.leader,
    team.mode,
  );
  const byLogin = new Map(result?.members.map((m) => [m.login.toLowerCase(), m]));
  const n = members.length;
  const leadActive = team.mode === "leader" && !!team.leader && n > 1;

  return (
    <div className="wrap">
      <nav className="crumbs">
        <Link href="/teams">Teams</Link>
        <span>/</span>
        <span>{team.name}</span>
      </nav>

      <header className="dossier-head" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
        <div>
          <p className="kicker">Team assessment</p>
          <h1 style={{ marginTop: 10 }}>{team.name}</h1>
          <p className="meta">
            <span>
              <b>{n}</b> {n === 1 ? "member" : "members"}
            </span>
            <span>
              {n <= 1
                ? "Solo team: 100% one member"
                : leadActive
                  ? `Lead-weighted: lead ${pct(Math.min(1, LEADER_FACTOR / n))}, others ${pct((1 - Math.min(1, LEADER_FACTOR / n)) / (n - 1))} each`
                  : "Equal average across members"}
            </span>
            <span>Created {relative(team.createdAt)}</span>
          </p>
          {skipped && (
            <p className="meta" style={{ color: "var(--danger)" }}>
              {skipped} username(s) could not be analysed and were not added.
            </p>
          )}
        </div>
        <div className="scorecard">
          <div className="figure">
            <span className="value">{result ? fmt(result.total, 1) : "—"}</span>
            <span className="of">/ 100</span>
          </div>
          {result && <Band band={result.band} />}
          <div className="actions">
            {n > 0 && (
              <ActionButton className="btn ghost small" action={refreshTeam.bind(null, team.id)} busy="Re-analysing…">
                Re-analyse all
              </ActionButton>
            )}
          </div>
        </div>
      </header>

      {result && (
        <section className="section" aria-labelledby="composition">
          <div className="section-head">
            <h2 id="composition">Score composition</h2>
            <span className="aside">Each segment is a member&rsquo;s weight × their own score</span>
          </div>
          <div className="composition">
            <div className="bar" role="img" aria-label={result.members.map((m) => `@${m.login} ${fmt(m.contribution, 1)} points`).join(", ")}>
              {result.members.map((m, k) => (
                <span
                  key={m.login}
                  className="seg"
                  title={`@${m.login}: ${pct(m.weight)} × ${fmt(m.score, 1)} = ${fmt(m.contribution, 1)} points`}
                  style={{ width: `${m.contribution}%`, background: seriesColor(k), ["--i" as string]: k }}
                />
              ))}
            </div>
            <div className="scale" aria-hidden>
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>

          <table className="standings" style={{ marginTop: 20 }}>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col" className="right">
                  Weight
                </th>
                <th scope="col" className="right">
                  Own score
                </th>
                <th scope="col" className="right">
                  Points
                </th>
                <th scope="col" className="hide-sm">
                  Analysed
                </th>
                <th scope="col" className="right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, k) => {
                const r = byLogin.get(m.login.toLowerCase());
                const isLead = !!team.leader && team.leader.toLowerCase() === m.login.toLowerCase();
                const colorIndex = result.members.findIndex((x) => x.login.toLowerCase() === m.login.toLowerCase());
                return (
                  <tr key={m.login} style={{ ["--i" as string]: k }}>
                    <td>
                      <div className="who">
                        <span className="swatch" style={{ background: colorIndex >= 0 ? seriesColor(colorIndex) : "var(--track)", marginRight: 0 }} aria-hidden />
                        <Avatar src={m.profile?.evidence.avatarUrl} login={m.login} />
                        <span className="names">
                          <span>
                            <Link className="primary" href={`/u/${m.login}`} style={{ position: "static" }}>
                              {m.profile?.evidence.name ?? m.login}
                            </Link>
                            {isLead && <span className="lead-tag">Lead</span>}
                          </span>
                          <span className="secondary">@{m.login}</span>
                        </span>
                      </div>
                    </td>
                    <td className="right num">{r ? pct(r.weight) : "—"}</td>
                    <td className="right num">{r ? fmt(r.score, 1) : "pending"}</td>
                    <td className="right num" style={{ fontSize: 17 }}>
                      {r ? fmt(r.contribution, 1) : "—"}
                    </td>
                    <td className="hide-sm muted" style={{ fontSize: 12.5 }}>
                      {m.profile ? relative(m.profile.analyzedAt) : "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        {n > 1 &&
                          (isLead ? (
                            <ActionButton action={setTeamLeader.bind(null, team.id, null)}>Unset lead</ActionButton>
                          ) : (
                            <ActionButton action={setTeamLeader.bind(null, team.id, m.login)}>Make lead</ActionButton>
                          ))}
                        <ActionButton className="textlink danger" action={removeTeamMember.bind(null, team.id, m.login)} confirm={`Remove @${m.login} from ${team.name}?`}>
                          Remove
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid-2 section">
        {result ? (
          <section aria-labelledby="profile">
            <div className="section-head">
              <h2 id="profile">Team profile</h2>
              <span className="aside">Weighted member dimensions</span>
            </div>
            <table className="ledger">
              <tbody>
                {result.dimensions.map((d, k) => (
                  <tr key={d.key}>
                    <td style={{ fontSize: 14, width: "42%" }}>{d.label}</td>
                    <td>
                      <Meter value={d.score / 100} i={k} label={`${d.label} ${fmt(d.score)}`} />
                    </td>
                    <td className="right pts" style={{ width: 56 }}>
                      {fmt(d.score, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="orientation" style={{ fontSize: 17 }}>
              {result.orientation} <span>· {pct(result.externalShare)} of recent work in others&rsquo; repositories</span>
            </p>
          </section>
        ) : (
          <section>
            <div className="empty-state" style={{ paddingTop: 8 }}>
              <h3>No members yet.</h3>
              <p>Add the first member on the right. A one-person team takes that person&rsquo;s score in full.</p>
            </div>
          </section>
        )}

        <section style={{ display: "grid", gap: 16, alignContent: "start" }} aria-label="Manage team">
          <AddMembers action={addTeamMembers.bind(null, team.id)} />
          <div className="panel">
            <h3>Weighting</h3>
            <p>Lead-weighted applies only when a lead is set and the team has two or more members.</p>
            <div className="segmented" role="group" aria-label="Weighting mode">
              {(["leader", "equal"] as const).map((mode) => (
                <ActionButton key={mode} className="seg-btn" action={setTeamMode.bind(null, team.id, mode)}>
                  <span aria-pressed={team.mode === mode} className={team.mode === mode ? "on" : undefined}>
                    {mode === "leader" ? "Lead-weighted" : "Equal average"}
                  </span>
                </ActionButton>
              ))}
            </div>
          </div>
          <RenameTeam action={renameTeam.bind(null, team.id)} name={team.name} />
          <div className="panel">
            <h3>Delete team</h3>
            <p>Members&rsquo; individual assessments are kept.</p>
            <div>
              <ActionButton className="btn danger small" action={deleteTeam.bind(null, team.id)} confirm={`Delete ${team.name}? This can't be undone.`} busy="Deleting…">
                Delete team
              </ActionButton>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
