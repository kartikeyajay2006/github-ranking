// Generates the animated README art in docs/readme/ (light + dark), SMIL only so GitHub animates it.
//   node scripts/readme-art.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../docs/readme/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const THEMES = {
  dark: {
    bg: "#0c0c0b", surface: "#141413", line: "#2a2a27", ink: "#f2f1ee", ink2: "#c6c5bc", ink3: "#8f8e86",
    accent: "#3987e5", hot: "#eb6834", dust: "#5d5c56",
    bands: ["#a9cdf7", "#72aaf0", "#3f8ae6", "#2c6cbd", "#2a4f80", "#4a4944"],
  },
  light: {
    bg: "#f6f6f3", surface: "#ffffff", line: "#dcdbd5", ink: "#0b0b0b", ink2: "#45443f", ink3: "#77766f",
    accent: "#2a78d6", hot: "#d9541f", dust: "#b9b8b1",
    bands: ["#0d3a72", "#1a58a6", "#2a78d6", "#5b98e0", "#97bdec", "#c4c3bc"],
  },
};
const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif";
const MONO = "ui-monospace,'SFMono-Regular','JetBrains Mono',Menlo,Consolas,monospace";
const SANS = "-apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif";

// Deterministic randomness so regenerating gives the same picture.
let seed = 20261114;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const f = (n) => Number(n.toFixed(1));

const DIMS = [
  ["PROJECTS", 30], ["BUILD DEPTH", 25], ["ACTIVITY", 15], ["IMPACT", 12], ["OPEN SOURCE", 10], ["BREADTH", 8],
];
const BANDS = [
  ["EXCEPTIONAL", "75+"], ["STRONG", "60–75"], ["PROFICIENT", "50–60"], ["DEVELOPING", "35–50"], ["EMERGING", "12–35"], ["INSUFFICIENT", "&lt;12"],
];

/** Length-proportional progress at which a sampled path first reaches x. */
function bezierPoints(segs) {
  const pts = [];
  for (const s of segs) {
    if (s.length === 4) {
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, u = 1 - t;
        pts.push([
          u ** 3 * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t ** 3 * s[3][0],
          u ** 3 * s[0][1] + 3 * u * u * t * s[1][1] + 3 * u * t * t * s[2][1] + t ** 3 * s[3][1],
        ]);
      }
    } else pts.push(s[0], s[1]);
  }
  return pts;
}
function progressAt(pts, x) {
  let total = 0, at = null;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (at === null && pts[i][0] >= x) at = total;
  }
  return Math.min(0.98, Math.max(0.02, (at ?? total) / total));
}

// ---------------------------------------------------------------- hero: the sieve
function hero(t) {
  const W = 1200, H = 548;
  const GX = [400, 480, 560, 640, 720, 800];
  const LANE_X0 = 880, LANE_X1 = 1168;
  const laneY = [232, 272, 312, 352, 392, 446];
  const pick = () => { // more people in the middle bands, as in real cohorts
    const r = rnd();
    return r < 0.06 ? 0 : r < 0.2 ? 1 : r < 0.38 ? 2 : r < 0.62 ? 3 : r < 0.86 ? 4 : 5;
  };
  let parts = "";
  for (let i = 0; i < 120; i++) {
    const band = pick();
    const y0 = 196 + rnd() * 296, yc = 286 + rnd() * 112, yl = laneY[band] + (rnd() - 0.5) * 8;
    const dur = 6.5 + rnd() * 3.5, begin = -rnd() * dur, r = 1.8 + rnd() * 1.9;
    const segs = [
      [[-12, y0], [210, y0], [300, yc], [GX[0] - 30, yc]],
      [[GX[0] - 30, yc], [GX[5] + 20, yc]],
      band === 5
        ? [[GX[5] + 20, yc], [860, yc], [880, yl], [960, yl + 6]]
        : [[GX[5] + 20, yc], [850, yc], [860, yl], [LANE_X0 + 10, yl]],
      band === 5 ? [[960, yl + 6], [1010, yl + 16], [1030, 500], [1040, 560]] : [[LANE_X0 + 10, yl], [LANE_X1 - 6, yl]],
    ];
    const d = `M${segs[0][0]} C${segs[0][1]} ${segs[0][2]} ${segs[0][3]} L${segs[1][1]} C${segs[2][1]} ${segs[2][2]} ${segs[2][3]} ${
      band === 5 ? `C${segs[3][1]} ${segs[3][2]} ${segs[3][3]}` : `L${segs[3][1]}`
    }`.replace(/(\d+\.\d{2,})/g, (m) => f(+m));
    const pts = bezierPoints(segs);
    const k = Number(progressAt(pts, GX[5] + 24).toFixed(2));
    const k0 = Number(progressAt(pts, GX[0] - 20).toFixed(2));
    parts += `<circle r="${f(r)}" fill="${t.ink3}">
<animateMotion dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite" path="${d}"/>
<animate attributeName="fill" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite" calcMode="discrete" keyTimes="0;${k};1" values="${t.ink3};${t.bands[band]};${t.bands[band]}"/>
<animate attributeName="opacity" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite" keyTimes="0;0.06;${k0};${k};0.9;1" values="0;0.55;0.8;1;1;0"/>
</circle>`;
  }

  // Gates: the glowing part of each gate is proportional to its weight.
  let gates = "";
  DIMS.forEach(([name, w], i) => {
    const x = GX[i], h = (w / 30) * 200, top = 244 + (200 - h) / 2;
    gates += `<line x1="${x}" y1="226" x2="${x}" y2="462" stroke="${t.line}" stroke-width="1"/>
<rect x="${x - 2}" y="${f(top)}" width="4" height="${f(h)}" rx="2" fill="${t.accent}" opacity="0.35">
<animate attributeName="opacity" values="0.3;1;0.3" keyTimes="0;0.12;1" dur="3s" begin="${f(i * 0.22)}s" repeatCount="indefinite"/>
</rect>
<rect x="${x - 7}" y="${f(top)}" width="14" height="${f(h)}" rx="7" fill="${t.accent}" opacity="0" filter="url(#glow)">
<animate attributeName="opacity" values="0;0.45;0" keyTimes="0;0.12;1" dur="3s" begin="${f(i * 0.22)}s" repeatCount="indefinite"/>
</rect>
<text x="${x}" y="488" text-anchor="middle" font-family="${MONO}" font-size="9.5" letter-spacing="0.6" fill="${t.ink3}">${name}</text>
<text x="${x}" y="214" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="600" fill="${t.ink}">${w}<tspan fill="${t.ink3}" font-size="10">%</tspan></text>`;
  });

  let lanes = "";
  BANDS.forEach(([name, range], i) => {
    const y = laneY[i], last = i === 5;
    lanes += last
      ? `<line x1="${LANE_X0}" y1="${y}" x2="${LANE_X0 + 70}" y2="${y}" stroke="${t.line}" stroke-dasharray="2 4"/>
<text x="${LANE_X1}" y="${y + 4}" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="0.8" fill="${t.ink3}">${name} ${range} · NEVER SELECTED</text>`
      : `<line x1="${LANE_X0}" y1="${y}" x2="${LANE_X1}" y2="${y}" stroke="${t.line}"/>
<rect x="${LANE_X0}" y="${y - 1}" width="3" height="2" fill="${t.bands[i]}"/>
<text x="${LANE_X1}" y="${y - 7}" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="0.8" fill="${t.ink2}">${name} <tspan fill="${t.ink3}">${range}</tspan></text>`;
  });

  // The cut-off: a hot line that sweeps between Proficient and Developing.
  const cut = `<g>
<line x1="${LANE_X0 - 6}" y1="372" x2="${LANE_X1}" y2="372" stroke="${t.hot}" stroke-width="1.4" stroke-dasharray="6 5">
<animate attributeName="stroke-dashoffset" values="0;-22" dur="1.2s" repeatCount="indefinite"/>
</line>
<text x="${LANE_X0 - 12}" y="376" text-anchor="end" font-family="${MONO}" font-size="10" font-weight="600" letter-spacing="0.8" fill="${t.hot}">CUT-OFF</text>
<text x="${LANE_X0}" y="198" font-family="${MONO}" font-size="10" font-weight="600" letter-spacing="1.2" fill="${t.hot}">▲ TOP N SELECTED ABOVE THE CUT-OFF</text>
</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="github-ranking: GitHub accounts flow through six weighted scoring gates and separate into bands; a cut-off selects the top teams.">
<defs>
<filter id="glow" x="-200%" y="-20%" width="500%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
<linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="${t.bg}"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></linearGradient>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${t.line}" stroke-width="0.6" opacity="0.55"/></pattern>
</defs>
<rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>
<rect x="0" y="170" width="${W}" height="${H - 170}" fill="url(#grid)" opacity="0.5"/>
<text x="44" y="78" font-family="${MONO}" font-size="12" letter-spacing="2.4" fill="${t.ink3}">GITHUB-RANKING · METHODOLOGY 2026.11-r8</text>
<text x="42" y="132" font-family="${SERIF}" font-size="50" fill="${t.ink}">Who builds, who contributes, <tspan font-style="italic" fill="${t.accent}">and how well.</tspan></text>
<rect x="44" y="96" width="0" height="2" fill="${t.accent}"><animate attributeName="width" values="0;0;360;360" keyTimes="0;0.05;0.4;1" dur="6s" repeatCount="indefinite"/></rect>
<text x="44" y="214" font-family="${MONO}" font-size="10" letter-spacing="1.2" fill="${t.ink3}">GITHUB ACCOUNTS IN</text>
<text x="${GX[0] - 40}" y="214" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="1.2" fill="${t.ink3}">WEIGHT →</text>
${gates}
${lanes}
${cut}
${parts}
<rect x="0" y="170" width="60" height="${H - 170}" fill="url(#fadeL)"/>
<text x="44" y="${H - 18}" font-family="${SANS}" font-size="11" fill="${t.ink3}">Illustration · each person is scored only on their own public evidence</text>
</svg>`;
}

// ---------------------------------------------------------------- how: one ledger, one team
function how(t) {
  const W = 1200, H = 430, CYCLE = 9;
  const ex = [82, 74, 61, 35, 40, 50]; // an example person
  const pts = DIMS.map(([, w], i) => (w * ex[i]) / 100);
  const total = pts.reduce((a, b) => a + b, 0);
  const kt = (s) => Number((s / CYCLE).toFixed(3));
  const grow = (start, to, attr = "width") =>
    `<animate attributeName="${attr}" dur="${CYCLE}s" repeatCount="indefinite" keyTimes="0;${kt(start)};${kt(start + 0.7)};0.93;1" values="0;0;${f(to)};${f(to)};0"/>`;
  const show = (start) =>
    `<animate attributeName="opacity" dur="${CYCLE}s" repeatCount="indefinite" keyTimes="0;${kt(start)};${kt(start + 0.3)};0.93;1" values="0;0;1;1;0"/>`;

  let ledger = `<text x="44" y="58" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${t.ink3}">ONE PERSON → ONE LEDGER</text>
<text x="44" y="92" font-family="${SERIF}" font-size="26" fill="${t.ink}">Every point traces to evidence.</text>`;
  DIMS.forEach(([name, w], i) => {
    const y = 128 + i * 34, s = 0.3 + i * 0.35;
    ledger += `<text x="44" y="${y + 9}" font-family="${MONO}" font-size="11" letter-spacing="0.6" fill="${t.ink2}">${name}</text>
<text x="190" y="${y + 9}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${t.ink3}">×${(w / 100).toFixed(2)}</text>
<rect x="206" y="${y}" width="260" height="10" rx="5" fill="${t.line}" opacity="0.6"/>
<rect x="206" y="${y}" width="${f((ex[i] / 100) * 260)}" height="10" rx="5" fill="${t.accent}">${grow(s, (ex[i] / 100) * 260)}</rect>
<text x="478" y="${y + 9}" font-family="${MONO}" font-size="11" fill="${t.ink3}">${ex[i]}${show(s + 0.5)}</text>
<text x="560" y="${y + 9}" text-anchor="end" font-family="${MONO}" font-size="12" font-weight="600" fill="${t.ink}">+${pts[i].toFixed(1)}${show(s + 0.6)}</text>`;
  });
  // Total bar: the six contributions stack into one 0-100 bar.
  const TX = 44, TY = 352, TW = 516, start = 0.3 + 6 * 0.35 + 0.3;
  let acc = 0;
  ledger += `<line x1="44" y1="336" x2="560" y2="336" stroke="${t.line}"/>
<rect x="${TX}" y="${TY}" width="${TW}" height="16" rx="3" fill="${t.line}" opacity="0.6"/>`;
  pts.forEach((p, i) => {
    const x = TX + (acc / 100) * TW, w = (p / 100) * TW;
    acc += p;
    const op = 1 - i * 0.12;
    ledger += `<rect x="${f(x)}" y="${TY}" width="${f(w - 1.5)}" height="16" fill="${t.accent}" opacity="${f(op)}">${grow(start + i * 0.18, w - 1.5)}</rect>`;
  });
  const end = start + 6 * 0.18 + 0.4;
  ledger += `<line x1="${TX + 0.6 * TW}" y1="${TY - 6}" x2="${TX + 0.6 * TW}" y2="${TY + 22}" stroke="${t.ink3}" stroke-dasharray="2 3"/>
<text x="${TX + 0.6 * TW}" y="${TY + 36}" text-anchor="middle" font-family="${MONO}" font-size="9.5" fill="${t.ink3}">60 · STRONG</text>
<text x="44" y="404" font-family="${MONO}" font-size="11" letter-spacing="0.6" fill="${t.ink3}">EXAMPLE TOTAL</text>
<g>${show(end)}<text x="560" y="410" text-anchor="end" font-family="${SERIF}" font-size="34" fill="${t.ink}">${total.toFixed(1)}<tspan font-family="${MONO}" font-size="12" fill="${t.accent}" dx="10">STRONG</tspan></text></g>`;

  // Teams: the lead carries 1.2× an equal share.
  const teams = [
    ["SOLO", [1]],
    ["TWO", [0.6, 0.4]],
    ["THREE", [0.4, 0.3, 0.3]],
    ["FOUR", [0.3, 0.7 / 3, 0.7 / 3, 0.7 / 3]],
  ];
  let team = `<text x="660" y="58" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${t.ink3}">TEAMS → LEAD-WEIGHTED</text>
<text x="660" y="92" font-family="${SERIF}" font-size="26" fill="${t.ink}">The lead carries 1.2× an equal share.</text>`;
  const BX = 760, BW = 396;
  teams.forEach(([label, ws], r) => {
    const y = 138 + r * 52;
    team += `<text x="660" y="${y + 15}" font-family="${MONO}" font-size="11" letter-spacing="0.8" fill="${t.ink2}">${label}</text>`;
    let x = BX;
    ws.forEach((w, i) => {
      const width = w * BW - 3, s = 0.4 + r * 0.45 + i * 0.12;
      team += `<rect x="${f(x)}" y="${y}" width="${f(width)}" height="22" rx="3" fill="${i === 0 ? t.accent : t.bands[3]}" opacity="${i === 0 ? 1 : 0.75}">${grow(s, width)}</rect>
<text x="${f(x + 8)}" y="${y + 15}" font-family="${MONO}" font-size="11" font-weight="600" fill="${i === 0 ? "#ffffff" : t.ink}">${i === 0 ? "★ " : ""}${Math.round(w * 1000) / 10}%${show(s + 0.55)}</text>`;
      x += w * BW;
    });
  });
  team += `<rect x="660" y="352" width="496" height="52" rx="8" fill="${t.surface}" stroke="${t.line}"/>
<circle cx="684" cy="378" r="5" fill="none" stroke="${t.hot}" stroke-width="1.6"><animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite"/></circle>
<text x="700" y="374" font-family="${SANS}" font-size="13" fill="${t.ink}">A member with no usable GitHub counts as 0.</text>
<text x="700" y="392" font-family="${SANS}" font-size="12" fill="${t.ink3}">Leaving a weak member's account blank can't raise a team's score.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="How a score is built: six weighted dimensions add up to a total out of 100; in teams the lead carries 1.2 times an equal share.">
<rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>
<line x1="620" y1="40" x2="620" y2="${H - 32}" stroke="${t.line}"/>
${ledger}
${team}
</svg>`;
}

// ---------------------------------------------------------------- access: no public link, ask by email
function access(t) {
  const W = 1200, H = 150;
  let dots = "";
  for (let i = 0; i < 26; i++) {
    const y = 20 + rnd() * 110, dur = 5 + rnd() * 5, begin = -rnd() * dur;
    dots += `<circle r="${f(1.2 + rnd() * 1.4)}" cy="${f(y)}" fill="${t.bands[Math.floor(rnd() * 5)]}" opacity="0.55">
<animate attributeName="cx" values="-10;${W + 10}" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite"/></circle>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="No public demo. For access or your own instance, email kartikeya2006jay@gmail.com">
<defs><clipPath id="c"><rect width="${W}" height="${H}" rx="14"/></clipPath>
<linearGradient id="scan" x1="0" x2="1"><stop offset="0" stop-color="${t.hot}" stop-opacity="0"/><stop offset="0.5" stop-color="${t.hot}" stop-opacity="0.22"/><stop offset="1" stop-color="${t.hot}" stop-opacity="0"/></linearGradient></defs>
<g clip-path="url(#c)">
<rect width="${W}" height="${H}" fill="${t.surface}"/>
${dots}
<rect y="0" width="220" height="${H}" fill="url(#scan)"><animate attributeName="x" values="-240;${W + 20}" dur="4.5s" repeatCount="indefinite"/></rect>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${t.line}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${t.hot}" stroke-width="1.5" stroke-dasharray="80 ${2 * (W + H) - 80}">
<animate attributeName="stroke-dashoffset" values="0;-${2 * (W + H)}" dur="6s" repeatCount="indefinite"/></rect>
<g transform="translate(44 44)">
<rect width="56" height="56" rx="12" fill="${t.bg}" stroke="${t.line}"/>
<path d="M18 26v-5a10 10 0 0 1 20 0v5" fill="none" stroke="${t.hot}" stroke-width="2.4" stroke-linecap="round"/>
<rect x="14" y="26" width="28" height="20" rx="4" fill="${t.hot}"/>
<circle cx="28" cy="35" r="2.6" fill="${t.bg}"><animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite"/></circle>
</g>
<text x="124" y="66" font-family="${MONO}" font-size="11" letter-spacing="2.2" fill="${t.hot}">NO PUBLIC LINK · PRIVATE INSTANCE</text>
<text x="124" y="98" font-family="${SERIF}" font-size="27" fill="${t.ink}">Want access or your own instance? <tspan fill="${t.accent}" font-family="${MONO}" font-size="22">kartikeya2006jay@gmail.com</tspan><tspan fill="${t.accent}" font-family="${MONO}" font-size="22">▍<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1s" repeatCount="indefinite"/></tspan></text>
<text x="124" y="122" font-family="${SANS}" font-size="12.5" fill="${t.ink3}">The live ranking holds real applicant data, so it is shared privately. Click to email.</text>
</svg>`;
}

for (const [mode, t] of Object.entries(THEMES)) {
  seed = 20261114; // same picture in both themes
  writeFileSync(new URL(`hero-${mode}.svg`, OUT), hero(t));
  writeFileSync(new URL(`how-${mode}.svg`, OUT), how(t));
  writeFileSync(new URL(`access-${mode}.svg`, OUT), access(t));
}
console.log("docs/readme: hero, how, access × light, dark");
