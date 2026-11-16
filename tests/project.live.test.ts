import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { collectProject } from "../src/lib/github/collect";
import { assessProject, parseProjectRef } from "../src/lib/scoring/project";

/** Calibration only (needs a token and PROJECT_SAMPLE=<json [{login, project}]>): prints how sample projects grade. */
describe.skipIf(!process.env.PROJECT_SAMPLE)("best-project calibration", () => {
  it("grades the sample", { timeout: 600_000 }, async () => {
    const sample = JSON.parse(readFileSync(process.env.PROJECT_SAMPLE!, "utf8")) as { login: string; project: string }[];
    for (const s of sample) {
      const ref = parseProjectRef(s.project);
      if ("problem" in ref) continue;
      const ev = await collectProject(s.login, ref.owner, ref.name);
      if (!ev) {
        console.log(`${s.login.padEnd(22)} ${ref.owner}/${ref.name} → not public`);
        continue;
      }
      const a = assessProject(ev);
      const parts = a.parts.map((p) => `${p.key.slice(0, 4)} ${Math.round(p.value * 100)}`).join(" ");
      console.log(
        `${a.score.toFixed(1).padStart(5)} q${a.quality.toFixed(0).padStart(3)} share ${a.share === null ? " ?? " : (a.share * 100).toFixed(0).padStart(3) + "%"}${a.fork ? " FORK" : ""}${a.owned ? "" : " not-own"} | ${parts} | ${(ev.codeBytes / 1024).toFixed(0)}KB ${ev.commitsTotal}c mine ${ev.commitsByOwner} ${ev.stars}★ ${ev.homepage ? "demo" : ""}`,
      );
    }
  });
});
