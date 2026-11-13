"use client";

import Link from "next/link";
import { Fragment, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { UploadState } from "@/app/upload/actions";
import { pauseImport, removeImport, resumeImport, retryImport, updateCutoff } from "@/app/upload/actions";

/* --------------------------------------------------------------- upload form --------------------------------------------------------------- */

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.tsv,.txt,.md,.json,.html,.htm";

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Reading document…" : "Read document"}
      </button>
      {pending && <span className="progress" aria-hidden />}
    </>
  );
}

export function UploadForm({ action, aiAvailable }: { action: (prev: UploadState | null, form: FormData) => Promise<UploadState>; aiAvailable: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const [mode, setMode] = useState<"file" | "link" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <form className="compose upload" action={formAction}>
      <input type="hidden" name="mode" value={mode} />
      <div className="col" style={{ gridColumn: "1 / -1" }}>
        <div className="segmented" role="tablist" aria-label="Source">
          {(
            [
              ["file", "Upload a file"],
              ["link", "Paste a link"],
              ["paste", "Paste text"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="_mode" checked={mode === value} onChange={() => setMode(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>

        {mode === "file" && (
          <label
            className={`dropzone${drag ? " over" : ""}${file ? " has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f && input.current) {
                const dt = new DataTransfer();
                dt.items.add(f);
                input.current.files = dt.files;
                setFile(f);
              }
            }}
          >
            <input ref={input} type="file" name="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
            {file ? (
              <>
                <span className="dz-title mono">{file.name}</span>
                <span className="dz-sub">{(file.size / 1024).toFixed(0)} KB · click to choose another</span>
              </>
            ) : (
              <>
                <span className="dz-title">Drop the applications file here, or click to choose</span>
                <span className="dz-sub mono">PDF · Word .docx · Excel .xlsx · CSV · text · HTML · up to 25 MB</span>
              </>
            )}
          </label>
        )}

        {mode === "link" && (
          <label className="field">
            <span>Link</span>
            <input className="input" name="link" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" autoComplete="off" />
            <small>
              Google Sheets, Google Docs, Google Drive files or any public file link. Google links must be shared as &ldquo;Anyone with the link can
              view&rdquo;. For a Google Form, share its response sheet.
            </small>
          </label>
        )}

        {mode === "paste" && (
          <label className="field">
            <span>Document text</span>
            <textarea className="textarea" name="text" rows={10} placeholder={"Team 1: Rocket\nLeader: Arjun Rao, github.com/arjunrao\nMember: Priya Sharma, github.com/priyas\n…"} />
          </label>
        )}
      </div>

      <div className="col">
        <label className="field">
          <span>Import name (optional)</span>
          <input className="input" name="name" maxLength={80} placeholder="e.g. Hackathon 2026 applications" autoComplete="off" />
        </label>
      </div>
      <div className="col">
        <label className={`check${aiAvailable ? "" : " disabled"}`}>
          <input type="checkbox" name="ai" disabled={!aiAvailable} />
          <span>
            <b>AI extraction</b> for free-form or messy documents.{" "}
            {aiAvailable ? (
              <>The document&rsquo;s text, including names and e-mails, is sent to Anthropic&rsquo;s API to read it.</>
            ) : (
              <>Set ANTHROPIC_API_KEY on the server to enable it. Spreadsheets and structured documents don&rsquo;t need it.</>
            )}
          </span>
        </label>
      </div>

      <div className="foot">
        <p>Nothing is ranked yet: the next step shows every team found, so you can check it before starting.</p>
        <ReadButton />
      </div>
      {state && !state.ok && (
        <div className="flash" role="alert" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
          <div className="line">
            <span className="mark err">ERROR</span>
            <span>{state.message}</span>
          </div>
        </div>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ live view ------------------------------------------------------------------ */

interface Progress {
  job: {
    id: string;
    name: string;
    source: string;
    method: string;
    status: "draft" | "running" | "paused" | "done";
    cutoff: number | null;
    note: string | null;
    resumeAt: number | null;
    startedAt: number | null;
    finishedAt: number | null;
  };
  counts: { total: number; pending: number; running: number; done: number; failed: number; people: number };
  ranked: {
    idx: number;
    name: string;
    teamId: string | null;
    score: number | null;
    band: string | null;
    lead: { name: string | null; github: string | null } | null;
    members: string[];
    warnings: string[];
    finishedAt: number | null;
  }[];
  failed: { idx: number; name: string; error: string | null }[];
  running: string[];
  now: number;
}

const STATUS_LABEL = { draft: "Draft", running: "Ranking", paused: "Paused", done: "Complete" } as const;

function duration(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function LiveImport({ id, initial }: { id: string; initial: Progress }) {
  const [data, setData] = useState<Progress>(initial);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [cutoff, setCutoffInput] = useState(initial.job.cutoff ? String(initial.job.cutoff) : "");
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const known = useRef(new Set(initial.ranked.map((r) => r.idx)));
  const router = useRouter();

  const refresh = async () => {
    const res = await fetch(`/api/imports/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const next = (await res.json()) as Progress;
    const added = next.ranked.filter((r) => !known.current.has(r.idx)).map((r) => r.idx);
    added.forEach((i) => known.current.add(i));
    if (added.length) {
      setFresh(new Set(added));
      setTimeout(() => setFresh(new Set()), 2400);
    }
    setData(next);
  };

  useEffect(() => {
    if (data.job.status !== "running") return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.job.status]);

  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      await refresh();
      router.refresh();
    });

  const { job, counts } = data;
  const finished = counts.done + counts.failed;
  const pct = counts.total ? (finished / counts.total) * 100 : 0;
  const elapsed = job.startedAt ? (job.finishedAt ?? data.now) - job.startedAt : 0;
  const eta = finished && job.status === "running" ? (elapsed / finished) * (counts.pending + counts.running) : null;
  const cut = job.cutoff;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.ranked
      .map((r, i) => ({ ...r, rank: i + 1, eligible: r.band !== "Insufficient" }))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.members.some((m) => m.toLowerCase().includes(q)) || (r.lead?.name ?? "").toLowerCase().includes(q));
  }, [data.ranked, query]);

  return (
    <div>
      <section className="live-head">
        <div className="live-status">
          <span className={`chip chip-${job.status}`}>
            <i aria-hidden />
            {STATUS_LABEL[job.status]}
          </span>
          {data.running.length > 0 && job.status === "running" && <span className="muted">Now: {data.running.join(", ")}</span>}
        </div>
        <div className="meter-xl" role="progressbar" aria-valuemin={0} aria-valuemax={counts.total} aria-valuenow={finished} aria-label="Teams processed">
          <i style={{ width: `${pct}%` }} />
        </div>
        <dl className="live-figures">
          <div>
            <dt>Ranked</dt>
            <dd className="num">
              {counts.done.toLocaleString("en-US")}
              <span className="muted"> / {counts.total.toLocaleString("en-US")}</span>
            </dd>
          </div>
          <div>
            <dt>Waiting</dt>
            <dd className="num">{(counts.pending + counts.running).toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd className="num">{counts.failed.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>{job.status === "done" ? "Took" : "Time left"}</dt>
            <dd className="num">{job.status === "done" ? duration(elapsed) : eta !== null ? `≈ ${duration(eta)}` : "—"}</dd>
          </div>
        </dl>
        {job.note && <p className="banner">{job.note}</p>}
        <div className="live-actions">
          {job.status === "running" && (
            <button className="btn ghost small" disabled={pending} onClick={() => act(() => pauseImport(id))}>
              Pause
            </button>
          )}
          {job.status === "paused" && (
            <button className="btn small" disabled={pending} onClick={() => act(() => resumeImport(id))}>
              Resume
            </button>
          )}
          {counts.failed > 0 && job.status !== "running" && (
            <button className="btn ghost small" disabled={pending} onClick={() => act(() => retryImport(id))}>
              Retry {counts.failed} failed
            </button>
          )}
          <a className="btn ghost small" href={`/api/imports/${id}/export`}>
            Export CSV
          </a>
          <button
            className="btn danger small"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete “${job.name}” and its ${counts.done} ranked teams? Members' individual analyses are kept.`)) act(() => removeImport(id));
            }}
          >
            Delete import
          </button>
        </div>
      </section>

      <section className="section" aria-labelledby="ranking">
        <div className="section-head">
          <h2 id="ranking">Ranking</h2>
          <div className="ranking-tools">
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(cutoff);
                act(() => updateCutoff(id, Number.isFinite(n) && n > 0 ? n : null));
              }}
            >
              <label className="sr-only" htmlFor="cutoff">
                Select top
              </label>
              <input id="cutoff" className="input small-input" inputMode="numeric" placeholder="Top N" value={cutoff} onChange={(e) => setCutoffInput(e.target.value.replace(/\D/g, ""))} />
              <button className="btn ghost small" type="submit" disabled={pending}>
                Set cut-off
              </button>
            </form>
            <input className="input small-input wide" type="search" placeholder="Search team, name or GitHub" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="muted" style={{ marginTop: 20 }}>
            {data.ranked.length ? "No team matches the search." : "The first results will appear here as soon as a team finishes."}
          </p>
        ) : (
          <table className="standings import-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Team</th>
                <th scope="col" className="hide-sm">
                  Lead
                </th>
                <th scope="col" className="hide-md">
                  Members
                </th>
                <th scope="col" className="right">
                  Score
                </th>
                <th scope="col" className="hide-sm">
                  Band
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.idx}>
                  <tr className={`${cut && r.rank <= cut && r.eligible ? "selected" : ""}${r.eligible ? "" : " ineligible"}${fresh.has(r.idx) ? " fresh" : ""}`}>
                    <td className="rank">{r.rank}</td>
                    <td>
                      {r.teamId ? (
                        <Link className="team-link" href={`/teams/${r.teamId}`}>
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                      {!r.eligible && (
                        <span className="ineligible-tag" title="Too little public work to judge: never selected">
                          not selectable
                        </span>
                      )}
                      {r.warnings.length > 0 && (
                        <span className="warn-dot" title={r.warnings.join("\n")}>
                          {r.warnings.length}
                        </span>
                      )}
                    </td>
                    <td className="hide-sm">
                      {r.lead ? (
                        <span className="who-mini">
                          {r.lead.name ?? "—"}
                          {r.lead.github && <span className="mono muted"> @{r.lead.github}</span>}
                        </span>
                      ) : (
                        <span className="muted">equal weights</span>
                      )}
                    </td>
                    <td className="hide-md">
                      <span className="handles">
                        {r.members.map((m) => (
                          <Link key={m} href={`/u/${m}`} className="handle">
                            @{m}
                          </Link>
                        ))}
                      </span>
                    </td>
                    <td className="score-cell">{r.score?.toFixed(1)}</td>
                    <td className="hide-sm">
                      <span className="band">{r.band}</span>
                    </td>
                  </tr>
                  {cut && r.rank === cut && !query && (
                    <tr className="cut-row" aria-label={`Cut-off: top ${cut}`}>
                      <td colSpan={6}>
                        <span>Top {cut.toLocaleString("en-US")} cut-off</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.failed.length > 0 && (
        <section className="section" aria-labelledby="failed">
          <div className="section-head">
            <h2 id="failed">Couldn&rsquo;t be ranked</h2>
            <span className="aside">
              {data.failed.length} {data.failed.length === 1 ? "team" : "teams"}
            </span>
          </div>
          <ul className="notes" style={{ marginTop: 16 }}>
            {data.failed.map((f) => (
              <li key={f.idx}>
                <span>
                  <b style={{ fontWeight: 500, color: "var(--ink)" }}>{f.name}</b> — {f.error}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Start button for a draft, with a pending state. */
export function StartButton({ teams, people }: { teams: number; people: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Starting…" : `Start ranking ${teams.toLocaleString("en-US")} teams (${people.toLocaleString("en-US")} people)`}
    </button>
  );
}

export function DiscardButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Discard this import?")) start(() => removeImport(id));
      }}
    >
      Discard
    </button>
  );
}
