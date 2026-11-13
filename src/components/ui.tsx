import type { Band as BandName, Dimension } from "@/lib/types";

const BANDS: BandName[] = ["Emerging", "Developing", "Proficient", "Strong", "Exceptional"];
const SHORT: Record<string, string> = { projects: "PRJ", opensource: "OSS", activity: "ACT", impact: "IMP", breadth: "BRD" };

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function relative(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function Band({ band }: { band: BandName }) {
  const level = BANDS.indexOf(band);
  return (
    <span className="band">
      <span className="pips" aria-hidden>
        {BANDS.map((b, i) => (
          <i key={b} className={i <= level ? "on" : undefined} />
        ))}
      </span>
      {band}
    </span>
  );
}

export function Strip({ dimensions, i = 0 }: { dimensions: Dimension[]; i?: number }) {
  return (
    <span className="strip" style={{ ["--i" as string]: i }} role="img" aria-label={dimensions.map((d) => `${d.label} ${fmt(d.score)}`).join(", ")}>
      {dimensions.map((d) => (
        <i key={d.key} style={{ ["--v" as string]: `${d.score}%` }} title={`${d.label}: ${fmt(d.score, 1)}`} />
      ))}
    </span>
  );
}

export function StripLegend() {
  return (
    <span className="strip-legend" aria-hidden>
      {Object.values(SHORT).map((s) => (
        <span key={s}>{s}</span>
      ))}
    </span>
  );
}

export function Split({ own, external, i = 0 }: { own: number; external: number; i?: number }) {
  const total = own + external;
  if (total === 0)
    return (
      <span className="split">
        <span className="bar">
          <i className="empty" />
        </span>
        <span className="caption">
          <span>no activity</span>
        </span>
      </span>
    );
  const ext = external / total;
  return (
    <span className="split" style={{ ["--i" as string]: i }} title={`Own & team work ${fmt(own)} · Outside contribution ${fmt(external)} (commits + PRs, last 12 months)`}>
      <span className="bar">
        {own > 0 && <i className="own" style={{ flex: own }} />}
        {external > 0 && <i className="ext" style={{ flex: external }} />}
      </span>
      <span className="caption">
        <span>own {pct(1 - ext)}</span>
        <span>outside {pct(ext)}</span>
      </span>
    </span>
  );
}

export function Meter({ value, thin, tone, i = 0, label }: { value: number; thin?: boolean; tone?: "ink"; i?: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span
      className={["meter", thin && "thin", tone].filter(Boolean).join(" ")}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
      style={{ ["--v" as string]: `${v * 100}%`, ["--i" as string]: i, display: "block" }}
    >
      <i />
    </span>
  );
}

export function Avatar({ src, login, size }: { src?: string | null; login: string; size?: "sm" | "lg" }) {
  const url = src ?? `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=96`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={["avatar", size].filter(Boolean).join(" ")} src={url} alt="" width={size === "lg" ? 88 : size === "sm" ? 24 : 36} height={size === "lg" ? 88 : size === "sm" ? 24 : 36} loading="lazy" />;
}

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
export const seriesColor = (index: number) => (index < SERIES.length ? SERIES[index]! : "var(--ink-3)");
