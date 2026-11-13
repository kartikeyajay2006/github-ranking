import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { previewImport } from "./actions";
import { UploadForm } from "@/components/imports";
import { relative } from "@/components/ui";
import { aiAvailable } from "@/lib/imports/ai";
import { listJobs } from "@/lib/imports/jobs";

export const metadata: Metadata = { title: "Upload" };

const STATUS = { draft: "Draft · not started", running: "Ranking", paused: "Paused", done: "Complete" } as const;

export default async function UploadPage() {
  await connection();
  const jobs = listJobs();

  return (
    <div className="wrap">
      <header className="page-head">
        <div>
          <p className="kicker">Bulk upload</p>
          <h1>Rank every application at once.</h1>
          <p className="lede">
            Upload the registrations document as a spreadsheet, PDF, Word file or Google link. Team names, leads, members and their GitHub accounts are
            read automatically. Teams are then ranked one by one in the background, and each result is saved the moment it finishes, so a list of a
            thousand teams fills in live and survives restarts.
          </p>
        </div>
        <dl className="stats">
          <div className="stat">
            <dt>Imports</dt>
            <dd>{jobs.length}</dd>
          </div>
          <div className="stat">
            <dt>Teams</dt>
            <dd>{jobs.reduce((s, j) => s + j.counts.total, 0).toLocaleString("en-US")}</dd>
          </div>
        </dl>
      </header>

      <UploadForm action={previewImport} aiAvailable={aiAvailable()} />

      {jobs.length > 0 && (
        <section className="section" aria-labelledby="imports">
          <div className="section-head">
            <h2 id="imports">Imports</h2>
          </div>
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">Import</th>
                <th scope="col" className="hide-sm">
                  Status
                </th>
                <th scope="col" style={{ width: "28%" }}>
                  Progress
                </th>
                <th scope="col" className="right hide-sm">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j, i) => {
                const done = j.counts.done + j.counts.failed;
                return (
                  <tr key={j.id} style={{ ["--i" as string]: i }}>
                    <td>
                      <div className="who">
                        <span className="names">
                          <Link className="primary" href={`/upload/${j.id}`}>
                            {j.name}
                          </Link>
                          <span className="secondary">{j.source}</span>
                        </span>
                      </div>
                    </td>
                    <td className="hide-sm">
                      <span className={`chip chip-${j.status}`}>
                        <i aria-hidden />
                        {STATUS[j.status]}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 6 }}>
                        <span className="meter thin" style={{ display: "block", ["--v" as string]: `${j.counts.total ? (done / j.counts.total) * 100 : 0}%` }}>
                          <i />
                        </span>
                        <span className="mono muted" style={{ fontSize: 12 }}>
                          {j.counts.done.toLocaleString("en-US")} of {j.counts.total.toLocaleString("en-US")} ranked
                          {j.counts.failed ? ` · ${j.counts.failed} failed` : ""}
                        </span>
                      </div>
                    </td>
                    <td className="right hide-sm muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {relative(j.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
