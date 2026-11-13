import Link from "next/link";
import { connection } from "next/server";
import { addIndividuals } from "./actions";
import { AddDevelopers } from "@/components/forms";
import { Avatar, Band, Split, Strip, StripLegend, fmt, relative } from "@/components/ui";
import { listIndividuals } from "@/lib/store";

export default async function IndividualsPage() {
  await connection();
  const rows = listIndividuals();
  const median = rows.length ? rows.map((r) => r.summary.total).sort((a, b) => a - b)[Math.floor((rows.length - 1) / 2)]! : null;

  return (
    <div className="wrap">
      <header className="page-head">
        <div>
          <p className="kicker">Individual standings</p>
          <h1>Who builds, who contributes, and how well.</h1>
          <p className="lede">
            Each developer is scored out of 100 on their public GitHub evidence alone. Most of the score is building: the quality of their projects
            and how much of them they wrote themselves. The rest is peer-reviewed open-source work, consistency, reach and breadth.
          </p>
        </div>
        <dl className="stats">
          <div className="stat">
            <dt>Ranked</dt>
            <dd>{rows.length}</dd>
          </div>
          <div className="stat">
            <dt>Median</dt>
            <dd>{median === null ? "—" : fmt(median, 1)}</dd>
          </div>
        </dl>
      </header>

      <AddDevelopers action={addIndividuals} />

      {rows.length === 0 ? (
        <div className="empty-state">
          <h3>No one is ranked yet.</h3>
          <p>
            Add a GitHub username above. Analysis takes a few seconds per person and reads only public data. Scores are absolute, so the order you add
            people in makes no difference.
          </p>
        </div>
      ) : (
        <div className="section" style={{ marginTop: 32 }}>
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Developer</th>
                <th scope="col" className="right">
                  Score
                </th>
                <th scope="col" className="hide-sm">
                  Band
                </th>
                <th scope="col" className="hide-md" aria-label="Dimension scores">
                  <StripLegend />
                </th>
                <th scope="col" className="hide-md">
                  Own vs outside
                </th>
                <th scope="col" className="right hide-sm">
                  Analysed
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const s = row.summary;
                const rank = rows.findIndex((r) => r.summary.total === s.total) + 1;
                return (
                  <tr key={row.login} style={{ ["--i" as string]: i }}>
                    <td className="rank">{rank}</td>
                    <td>
                      <div className="who">
                        <Avatar src={s.avatarUrl} login={s.login} />
                        <span className="names">
                          <Link className="primary" href={`/u/${s.login}`}>
                            {s.name ?? s.login}
                          </Link>
                          <span className="secondary">@{s.login}</span>
                        </span>
                      </div>
                    </td>
                    <td className="score-cell">{fmt(s.total, 1)}</td>
                    <td className="hide-sm">
                      <Band band={s.band} />
                    </td>
                    <td className="hide-md">
                      <Strip dimensions={s.dimensions} i={i} />
                    </td>
                    <td className="hide-md">
                      <Split own={s.split.own} external={s.split.external} i={i} />
                    </td>
                    <td className="right hide-sm muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {relative(s.analyzedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="legend-row">
            <span className="key">
              PRJ project quality · DEP build depth · OSS open-source contribution · ACT activity · IMP impact · BRD breadth
            </span>
            <span className="key">
              <i style={{ background: "var(--accent)" }} /> own &amp; team work
            </span>
            <span className="key">
              <i style={{ background: "var(--external)" }} /> outside contribution (commits + PRs, 12 months)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
