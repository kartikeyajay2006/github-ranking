import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { collectProfile } from "@/lib/github/collect";
import { assess } from "@/lib/scoring/individual";

/** Live calibration against real accounts: CALIBRATE=a,b,c CALIBRATE_OUT=path npm run calibrate */
const logins = (process.env.CALIBRATE ?? "").split(",").filter(Boolean);
const out = process.env.CALIBRATE_OUT ?? "calibration.txt";

test.skipIf(!logins.length)("calibrate", { timeout: 900_000 }, async () => {
  for (const login of logins) {
    const t = Date.now();
    const { evidence, notes } = await collectProfile(login);
    const a = assess(evidence, Date.parse(evidence.fetchedAt), notes);
    const lines = [
      `${login.padEnd(18)} ${String(a.total).padStart(5)} ${a.band.padEnd(11)} ` +
        a.dimensions.map((d) => `${d.key.slice(0, 4)}=${d.score}`).join(" ") +
        ` | ${a.orientation} ext=${(a.split.externalShare * 100).toFixed(0)}% | inspected=${evidence.inspected.length} ${((Date.now() - t) / 1000).toFixed(1)}s`,
      ...a.notes.map((n) => `   note: ${n}`),
    ];
    appendFileSync(out, lines.join("\n") + "\n");
  }
});
