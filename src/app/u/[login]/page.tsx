import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { enterIndividual, refreshProfile, removeIndividual } from "@/app/actions";
import { ActionButton } from "@/components/forms";
import { Heatmap } from "@/components/heatmap";
import { Avatar, Band, Meter, fmt, pct, relative } from "@/components/ui";
import { normaliseLogin } from "@/lib/github/collect";
import { getProfile, isIndividual, teamsForLogin } from "@/lib/store";

type Props = { params: Promise<{ login: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { login } = await params;
  return { title: `@${decodeURIComponent(login)}` };
}

const SIGNALS: [keyof import("@/lib/types").RepoAssessment["signals"], string, string][] = [
  ["readme", "README", "README over 1.5 KB"],
  ["tests", "TEST", "Test suite detected"],
  ["ci", "CI", "Continuous integration configured"],
  ["license", "LIC", "Licence declared"],
  ["releases", "REL", "Published releases"],
  ["docs", "DOCS", "Docs folder or homepage"],
  ["maintained", "LIVE", "Pushed in the last six months"],
];

export default async function DossierPage({ params }: Props) {
  await connection();
  const raw = decodeURIComponent((await params).login);
  const login = normaliseLogin(raw);
  if (!login) notFound();
  const profile = getProfile(login);

  if (!profile) {
    return (
      <div className="wrap">
        <nav className="crumbs">
          <Link href="/">Standings</Link>
          <span>/</span>
          <span>@{login}</span>
        </nav>
        <div className="empty-state">
          <h3>@{login} hasn&rsquo;t been analysed yet.</h3>
          <p>Analysis reads this account&rsquo;s public repositories and contribution history. Nothing about other participants is used.</p>
          <div>
            <ActionButton className="btn" action={refreshProfile.bind(null, login)} busy="Analysing…">
              Analyse @{login}
            </ActionButton>
          </div>
        </div>
      </div>
    );
  }

  const { evidence: e, assessment: a } = profile;
  const ranked = isIndividual(e.login);
  const teams = teamsForLogin(e.login);
  const ext = e.external;
  const decided = ext.merged + ext.closedUnmerged;
  const topExternal = [...new Map(ext.sample.map((p) => [p.repo, p])).values()]
    .map((p) => ({ ...p, count: ext.sample.filter((s) => s.repo === p.repo).length, last: ext.sample.filter((s) => s.repo === p.repo).map((s) => s.mergedAt).sort().at(-1)! }))
    .sort((x, y) => y.stars - x.stars || y.count - x.count)
    .slice(0, 8);
  const shown = a.repos.slice(0, 12);
  let i = 0;

  return (
    <div className="wrap">
      <nav className="crumbs">
        <Link href="/">Standings</Link>
        <span>/</span>
        <span>@{e.login}</span>
      </nav>

      <header className="dossier-head">
        <Avatar src={e.avatarUrl} login={e.login} size="lg" />
        <div>
          <p className="kicker">Developer assessment</p>
          <h1 style={{ marginTop: 10 }}>{e.name ?? e.login}</h1>
          <p className="handle">
            <a className="link" href={`https://github.com/${e.login}`} target="_blank" rel="noreferrer">
              github.com/{e.login}
            </a>
          </p>
          {e.bio && <p className="bio">{e.bio}</p>}
          <p className="meta">
            {e.company && <span>{e.company}</span>}
            {e.location && <span>{e.location}</span>}
            <span>
              Joined <b>{new Date(e.createdAt).getFullYear()}</b>
            </span>
            <span>
              <b>{fmt(e.ownedRepoCount)}</b> original repos
            </span>
            <span>
              <b>{fmt(e.followers)}</b> followers
            </span>
            {teams.map((t) => (
              <Link key={t.id} className="link" href={`/teams/${t.id}`}>
                {t.name}
              </Link>
            ))}
          </p>
        </div>
        <div className="scorecard">
          <div className="figure">
            <span className="value">{fmt(a.total, 1)}</span>
            <span className="of">/ 100</span>
          </div>
          <Band band={a.band} />
          <p className="stamp">
            Analysed {relative(profile.analyzedAt)}
            <br />
            methodology {a.methodology}
          </p>
          <div className="actions">
            <ActionButton className="btn ghost small" action={refreshProfile.bind(null, e.login)} busy="Re-analysing…">
              Re-analyse
            </ActionButton>
            {ranked ? (
              <ActionButton className="btn ghost small" action={removeIndividual.bind(null, e.login)} confirm={`Remove @${e.login} from the individual standings?`}>
                Remove from standings
              </ActionButton>
            ) : (
              <ActionButton className="btn small" action={enterIndividual.bind(null, e.login)}>
                Add to standings
              </ActionButton>
            )}
          </div>
        </div>
      </header>

      <section className="section" aria-labelledby="ledger">
        <div className="section-head">
          <h2 id="ledger">Score ledger</h2>
          <span className="aside">Points column sums to the total</span>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Dimension / factor</th>
              <th scope="col" className="hide-sm">
                Evidence
              </th>
              <th scope="col" style={{ width: "22%" }}>
                Achievement
              </th>
              <th scope="col" className="right">
                Weight
              </th>
              <th scope="col" className="right">
                Points
              </th>
            </tr>
          </thead>
          {a.dimensions.map((d) => (
            <tbody key={d.key}>
              <tr className="dim">
                <td className="label">{d.label}</td>
                <td className="hide-sm" />
                <td>
                  <Meter value={d.score / 100} i={i++} label={`${d.label} ${fmt(d.score)} of 100`} />
                </td>
                <td className="right w">{pct(d.weight)}</td>
                <td className="right pts">{fmt(d.score * d.weight, 1)}</td>
              </tr>
              {d.factors.map((f) => (
                <tr className="factor" key={f.key}>
                  <td className="label">{f.label}</td>
                  <td className="evidence hide-sm">{f.evidence}</td>
                  <td>
                    <Meter value={f.value} thin tone="ink" i={i++} label={`${f.label} ${Math.round(f.value * 100)}%`} />
                  </td>
                  <td className="right w">{pct(f.weight)}</td>
                  <td className="right pts muted">{fmt(f.value * f.weight * d.weight * 100, 1)}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tbody>
            <tr className="total">
              <td>Total</td>
              <td className="hide-sm" />
              <td />
              <td className="right w">100%</td>
              <td className="right pts">{fmt(a.total, 1)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="grid-2 section">
        <section aria-labelledby="split">
          <div className="section-head">
            <h2 id="split">Own work vs. contribution</h2>
            <span className="aside">Commits + PRs, 12 months</span>
          </div>
          {a.split.own + a.split.external > 0 ? (
            <div className="splitboard">
              <div className="bar" role="img" aria-label={`Own repositories ${pct(1 - a.split.externalShare)}, others' repositories ${pct(a.split.externalShare)}`}>
                {a.split.own > 0 && <i style={{ flex: a.split.own, background: "var(--accent)" }} />}
                {a.split.external > 0 && <i style={{ flex: a.split.external, background: "var(--external)", animationDelay: "120ms" }} />}
              </div>
              <div className="legend">
                <div>
                  <span className="key">
                    <i style={{ background: "var(--accent)" }} /> Own repositories
                  </span>
                  <span className="n num">{fmt(a.split.own)}</span>
                  <span className="muted num" style={{ fontSize: 12.5 }}>
                    {pct(1 - a.split.externalShare)}
                  </span>
                </div>
                <div>
                  <span className="key">
                    <i style={{ background: "var(--external)" }} /> Others&rsquo; repositories
                  </span>
                  <span className="n num">{fmt(a.split.external)}</span>
                  <span className="muted num" style={{ fontSize: 12.5 }}>
                    {pct(a.split.externalShare)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 20 }}>
              No commits or pull requests in the last 12 months.
            </p>
          )}
          <p className="orientation">
            {a.orientation} <span>profile</span>
          </p>
          <dl className="figures" style={{ marginTop: 20 }}>
            <div>
              <dt>Merged external PRs</dt>
              <dd>{fmt(ext.merged)}</dd>
            </div>
            <div>
              <dt>Acceptance</dt>
              <dd>{decided ? pct(ext.merged / decided) : "—"}</dd>
            </div>
            <div>
              <dt>Open PRs</dt>
              <dd>{fmt(ext.open)}</dd>
            </div>
            <div>
              <dt>Issues filed</dt>
              <dd>{fmt(ext.issues)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="external">
          <div className="section-head">
            <h2 id="external">Where their PRs landed</h2>
            <span className="aside">{ext.sample.length < ext.merged ? `Sample of ${ext.sample.length}` : "All merged"}</span>
          </div>
          {topExternal.length ? (
            <table className="standings">
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col" className="right">
                    Stars
                  </th>
                  <th scope="col" className="right">
                    PRs
                  </th>
                  <th scope="col" className="right hide-sm">
                    Latest
                  </th>
                </tr>
              </thead>
              <tbody>
                {topExternal.map((p, k) => (
                  <tr key={p.repo} style={{ ["--i" as string]: k }}>
                    <td>
                      <a className="repo-name" href={`https://github.com/${p.repo}/pulls?q=is%3Apr+is%3Amerged+author%3A${e.login}`} target="_blank" rel="noreferrer">
                        {p.repo}
                      </a>
                    </td>
                    <td className="right num">{fmt(p.stars)}</td>
                    <td className="right num">{p.count}</td>
                    <td className="right num muted hide-sm" style={{ fontSize: 12.5 }}>
                      {p.last.slice(0, 7)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ marginTop: 20 }}>
              No merged pull requests to repositories outside this account.
            </p>
          )}
        </section>
      </div>

      <section className="section" aria-labelledby="repos">
        <div className="section-head">
          <h2 id="repos">Repositories inspected</h2>
          <span className="aside">
            Top {Math.min(5, a.repos.length)} carry 35 / 25 / 18 / 12 / 10% of project quality
          </span>
        </div>
        {shown.length ? (
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col" className="hide-md">
                  Signals
                </th>
                <th scope="col" className="right hide-sm">
                  Stars
                </th>
                <th scope="col" className="right hide-sm">
                  Commits
                </th>
                <th scope="col" style={{ width: 140 }}>
                  Quality
                </th>
                <th scope="col" className="right">
                  Weight
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, k) => (
                <tr key={r.nameWithOwner} style={{ ["--i" as string]: k }}>
                  <td style={{ maxWidth: 380 }}>
                    <a className="repo-name" href={r.url} target="_blank" rel="noreferrer">
                      {r.nameWithOwner.split("/")[1]}
                    </a>
                    <span className="muted mono" style={{ fontSize: 11.5, marginLeft: 8 }}>
                      {r.language}
                    </span>
                    {r.description && <div className="repo-desc">{r.description}</div>}
                  </td>
                  <td className="hide-md">
                    <span className="signals">
                      {SIGNALS.map(([key, label, title]) => (
                        <span key={key} className={r.signals[key] ? "on" : undefined} title={`${title}: ${r.signals[key] ? "yes" : "no"}`}>
                          {label}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="right num hide-sm">{fmt(r.stars)}</td>
                  <td className="right num hide-sm">{fmt(r.commitsByOwner)}</td>
                  <td>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 40px", gap: 10, alignItems: "center" }}>
                      <Meter value={r.quality / 100} i={k} label={`Quality ${fmt(r.quality)}`} />
                      <span className="num right" style={{ fontSize: 13 }}>
                        {fmt(r.quality)}
                      </span>
                    </div>
                  </td>
                  <td className="right num muted" style={{ fontSize: 12.5 }}>
                    {r.portfolioWeight ? pct(r.portfolioWeight) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ marginTop: 20 }}>
            No public original repositories to inspect.
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="activity">
        <div className="section-head">
          <h2 id="activity">Activity, last 12 months</h2>
          <span className="aside num">{fmt(e.year.totalContributions)} contributions</span>
        </div>
        <div style={{ marginTop: 20 }}>
          <Heatmap days={e.year.calendar} />
        </div>
      </section>

      {a.notes.length > 0 && (
        <section className="section" aria-labelledby="notes">
          <div className="section-head">
            <h2 id="notes">Notes on the evidence</h2>
          </div>
          <ul className="notes" style={{ marginTop: 16 }}>
            {a.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
