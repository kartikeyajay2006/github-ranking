"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContributionDay } from "@/lib/types";

const CELL = 11;
const GAP = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Levels use fixed thresholds (not this person's own maximum), so two heatmaps can be compared by eye. */
const level = (n: number) => (n === 0 ? 0 : n < 3 ? 1 : n < 7 ? 2 : n < 15 ? 3 : 4);

export function Heatmap({ days }: { days: ContributionDay[] }) {
  const [hover, setHover] = useState<ContributionDay | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // On narrow screens the calendar scrolls; open it on the most recent weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const { weeks, months } = useMemo(() => {
    const weeks: (ContributionDay | null)[][] = [];
    let week: (ContributionDay | null)[] = [];
    days.forEach((d, i) => {
      const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
      if (i === 0) for (let k = 0; k < dow; k++) week.push(null);
      week.push(d);
      if (dow === 6) {
        weeks.push(week);
        week = [];
      }
    });
    if (week.length) weeks.push(week);
    const months: { x: number; label: string }[] = [];
    let last = -1;
    weeks.forEach((w, i) => {
      const first = w.find(Boolean);
      if (!first) return;
      const m = new Date(first.date + "T00:00:00Z").getUTCMonth();
      if (m !== last) {
        if (i < weeks.length - 2) months.push({ x: i * (CELL + GAP), label: MONTHS[m]! });
        last = m;
      }
    });
    return { weeks, months };
  }, [days]);

  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP) + 18;

  return (
    <div>
      <div className="heat" ref={scroller}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Contribution calendar for the last 12 months" onMouseLeave={() => setHover(null)}>
          {months.map((m) => (
            <text key={`${m.x}-${m.label}`} x={m.x} y={10} fontSize={10} fill="var(--ink-3)" fontFamily="var(--font-mono)">
              {m.label}
            </text>
          ))}
          {weeks.map((w, x) =>
            w.map((d, y) =>
              d ? (
                <rect
                  key={d.date}
                  data-level={level(d.count)}
                  x={x * (CELL + GAP)}
                  y={18 + y * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={`var(--heat-${level(d.count)})`}
                  onMouseEnter={() => setHover(d)}
                  onFocus={() => setHover(d)}
                >
                  <title>{`${d.count} on ${d.date}`}</title>
                </rect>
              ) : null,
            ),
          )}
        </svg>
      </div>
      <div className="heat-foot">
        <span aria-live="polite">
          {hover ? (
            <>
              <b className="num" style={{ color: "var(--ink)", fontWeight: 500 }}>
                {hover.count}
              </b>{" "}
              {hover.count === 1 ? "contribution" : "contributions"} on{" "}
              {new Date(hover.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
            </>
          ) : (
            "Hover a day for its count."
          )}
        </span>
        <span className="heat-scale" aria-label="Scale: 0, 1–2, 3–6, 7–14, 15 or more">
          <span style={{ marginRight: 4 }}>0</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} style={{ background: `var(--heat-${l})` }} />
          ))}
          <span style={{ marginLeft: 4 }}>15+</span>
        </span>
      </div>
    </div>
  );
}
