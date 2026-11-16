import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { startImport } from "../actions";
import { DiscardButton, LiveImport, StartButton } from "@/components/imports";
import { isWithdrawnTeam, leaderOf } from "@/lib/imports/extract";
import { parseProjectRef } from "@/lib/scoring/project";
import { getJob, jobCounts, jobTeams, rankedTeams } from "@/lib/imports/jobs";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const job = getJob((await params).id);
  return { title: job?.name ?? "Import" };
}

const METHOD = { table: "read as a table", text: "read as a document", ai: "read with AI extraction" } as Record<string, string>;
const PER_HOUR = 700; // measured: ~5 GitHub API points per person against 5,000 points an hour, with headroom

export default async function ImportPage({ params }: Props) {
  await connection();
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();
  const counts = jobCounts(id);

  const head = (
    <>
      <nav className="crumbs">
        <Link href="/upload">Upload</Link>
        <span>/</span>
        <span>{job.name}</span>
      </nav>
      <header className="page-head">
        <div>
          <p className="kicker">{job.status === "draft" ? "Check the extraction" : "Live ranking"}</p>
          <h1>{job.name}</h1>
          <p className="lede">
            {job.source} · {METHOD[job.method] ?? job.method} · {counts.total.toLocaleString("en-US")} teams · {counts.people.toLocaleString("en-US")}{" "}
            GitHub accounts
          </p>
        </div>
      </header>
    </>
  );

  if (job.status === "draft") {
    const teams = jobTeams(id);
    const withdrawnTeams = teams.filter(isWithdrawnTeam).length;
    const withdrawnPeople = teams.reduce((s, t) => s + t.members.filter((m) => m.withdrawn).length, 0);
    const activeMembers = teams.flatMap((t) => t.members.filter((m) => !m.withdrawn));
    const members = activeMembers.length;
    const missing = activeMembers.filter((m) => !m.github).length;
    const unmarked = teams.filter((t) => !t.members.some((m) => m.leader)).length;
    const noGithub = teams.filter((t) => !isWithdrawnTeam(t) && !t.members.some((m) => m.github && !m.withdrawn)).length;
    const hasProjects = activeMembers.some((m) => m.project !== undefined);
    const gradable = activeMembers.filter((m) => m.github && !("problem" in parseProjectRef(m.project))).length;
    const otherLinks = activeMembers.filter((m) => m.project && "problem" in parseProjectRef(m.project)).length;
    const noProject = activeMembers.filter((m) => !m.project).length;
    const duplicates = teams.filter((t) => t.warnings.some((w) => /is also in|gave the same GitHub/.test(w))).length;
    const sameName = teams.filter((t) => t.warnings.some((w) => /different teams are called/.test(w))).length;
    const hours = (counts.people * (hasProjects ? 1.3 : 1)) / PER_HOUR;

    return (
      <div className="wrap">
        {head}
        <dl className="figures" style={{ marginTop: 28 }}>
          <div>
            <dt>Teams found</dt>
            <dd>{teams.length.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Members</dt>
            <dd>{members.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Missing GitHub</dt>
            <dd>{missing.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>No lead marked</dt>
            <dd>{unmarked.toLocaleString("en-US")}</dd>
          </div>
          {hasProjects && (
            <div>
              <dt>Best projects to grade</dt>
              <dd>{gradable.toLocaleString("en-US")}</dd>
            </div>
          )}
          {withdrawnPeople > 0 && (
            <div>
              <dt>Withdrawn</dt>
              <dd>
                {withdrawnTeams.toLocaleString("en-US")}
                <span className="muted" style={{ fontSize: "0.5em" }}>
                  {" "}
                  teams · {withdrawnPeople} people
                </span>
              </dd>
            </div>
          )}
          <div>
            <dt>Estimated time</dt>
            <dd>{hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} h`}</dd>
          </div>
        </dl>

        <form className="compose" action={startImport.bind(null, id)} style={{ marginTop: 28 }}>
          <div className="col">
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <span>Teams with no lead marked ({unmarked})</span>
              <div className="segmented">
                <label>
                  <input type="radio" name="policy" value="first" defaultChecked />
                  <span>First listed member leads</span>
                </label>
                <label>
                  <input type="radio" name="policy" value="equal" />
                  <span>Equal average</span>
                </label>
              </div>
              <small>A marked lead carries 1.2× an equal share (40/30/30 for three). A one-person team is 100% that person.</small>
            </fieldset>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <span>Members without a usable GitHub account ({missing})</span>
              <div className="segmented">
                <label>
                  <input type="radio" name="missing" value="zero" defaultChecked />
                  <span>Count as 0</span>
                </label>
                <label>
                  <input type="radio" name="missing" value="skip" />
                  <span>Leave them out</span>
                </label>
              </div>
              <small>
                Counting them as 0 keeps their share of the team weight, so a team can&rsquo;t raise its score by leaving a weaker member&rsquo;s GitHub
                blank or mistyped.
              </small>
            </fieldset>
          </div>
          <div className="col">
            {hasProjects && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <span>
                  Best project weight ({gradable} gradable · {otherLinks} other links · {noProject} none)
                </span>
                <div className="segmented">
                  {[0, 30, 50, 70].map((v) => (
                    <label key={v}>
                      <input type="radio" name="projectWeight" value={v} defaultChecked={v === 30} />
                      <span>{v === 0 ? "GitHub only" : `${100 - v}/${v}`}</span>
                    </label>
                  ))}
                </div>
                <small>
                  Each person&rsquo;s score = GitHub profile × the first number + their best project (one GitHub repository, graded on its own and on how much of it
                  they wrote) × the second. Changeable after ranking, instantly.
                </small>
                <div className="segmented" style={{ marginTop: 8 }}>
                  <label>
                    <input type="radio" name="projectMissing" value="github" defaultChecked />
                    <span>No gradable project → GitHub only</span>
                  </label>
                  <label>
                    <input type="radio" name="projectMissing" value="zero" />
                    <span>→ project counts as 0</span>
                  </label>
                </div>
              </fieldset>
            )}
            {withdrawnPeople > 0 && (
              <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                <span>Withdrawn people ({withdrawnPeople})</span>
                <div className="segmented">
                  <label>
                    <input type="radio" name="withdrawn" value="skip" defaultChecked />
                    <span>Leave them out</span>
                  </label>
                  <label>
                    <input type="radio" name="withdrawn" value="keep" />
                    <span>Rank them too</span>
                  </label>
                </div>
                <small>
                  Left out: {withdrawnTeams} fully withdrawn {withdrawnTeams === 1 ? "team is" : "teams are"} not ranked, and withdrawn members don&rsquo;t count in
                  their team.
                </small>
              </fieldset>
            )}
            <label className="field">
              <span>Select top (optional)</span>
              <input className="input" name="cutoff" inputMode="numeric" pattern="[0-9]*" placeholder="e.g. 800" />
              <small>Draws a cut-off line in the ranking and marks selected teams in the CSV export. It can be changed later.</small>
            </label>
          </div>
          <div className="foot">
            <p>
              Each person is analysed on their own GitHub evidence only. Ranking runs in the background: you can close this page and come back.
              {duplicates > 0 && ` ${duplicates} teams share a person with another team or had two members type the same GitHub — they are flagged with ⚠.`}
              {sameName > 0 && ` ${sameName} teams share a name with a different team; each is shown with its lead's name.`}
              {noGithub > 0 && ` ${noGithub} teams have no GitHub accounts and will be listed as failed.`}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <DiscardButton id={id} />
              <StartButton teams={teams.length} people={counts.people} />
            </div>
          </div>
        </form>

        <section className="section" aria-labelledby="found">
          <div className="section-head">
            <h2 id="found">Teams found</h2>
            <span className="aside">Lead shown with ★. Members without GitHub can&rsquo;t be scored.</span>
          </div>
          <table className="standings preview-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Team</th>
                <th scope="col">Members</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => {
                const lead = leaderOf(t, "first");
                return (
                  <tr key={t.idx} style={{ ["--i" as string]: Math.min(i, 20) }}>
                    <td className="rank">{i + 1}</td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{t.name}</span>
                      {t.warnings.map((w) => (
                        <div key={w} className="warn-line">
                          {w}
                        </div>
                      ))}
                    </td>
                    <td>
                      <span className="people">
                        {t.members.map((m, k) => (
                          <span key={k} className={`person${m.github ? "" : " missing"}${m.withdrawn ? " withdrawn" : ""}`} title={[m.email, m.project && `Best project: ${m.project}`, m.withdrawn && "Withdrawn"].filter(Boolean).join("\n") || undefined}>
                            {m.leader || (k === lead && !t.members.some((x) => x.leader)) ? (
                              <b className={m.leader ? "star" : "star soft"} title={m.leader ? "Marked lead" : "Lead if “first listed” is chosen"}>
                                ★
                              </b>
                            ) : null}
                            {m.name ?? <span className="muted">unnamed</span>}
                            <span className="mono">{m.github ? ` @${m.github}` : " · no GitHub"}</span>
                            {m.project && !("problem" in parseProjectRef(m.project)) && (
                              <span className="proj-tag" title={m.project}>
                                project
                              </span>
                            )}
                            {m.withdrawn && <span className="ineligible-tag">withdrawn</span>}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  const ranked = rankedTeams(id).map((t) => {
    const lead = t.leader !== null ? t.members[t.leader] : null;
    return {
      idx: t.idx,
      name: t.name,
      teamId: t.teamId,
      score: t.score,
      band: t.band,
      githubScore: t.githubScore,
      projectScore: t.projectScore,
      lead: lead ? { name: lead.name, github: lead.github } : null,
      members: t.members.filter((m) => m.github).map((m) => m.github!),
      warnings: t.warnings,
      finishedAt: t.finishedAt,
    };
  });
  const initial = {
    job,
    counts,
    ranked,
    failed: jobTeams(id, "failed").map((t) => ({ idx: t.idx, name: t.name, error: t.error })),
    running: jobTeams(id, "running").map((t) => t.name),
    now: Date.now(),
  };

  return (
    <div className="wrap">
      {head}
      <LiveImport id={id} initial={initial} />
    </div>
  );
}
