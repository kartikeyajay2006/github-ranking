import { test } from "vitest";
import { appendFileSync } from "node:fs";
import { collectProfile } from "@/lib/github/collect";
import { assess } from "@/lib/scoring/individual";
import { graphql } from "@/lib/github/client";
const rl = async () => (await graphql<{ rateLimit: { remaining: number } }>("{ rateLimit { remaining } }")).data.rateLimit.remaining;
test.skipIf(!process.env.LOGINS)("bench", { timeout: 900000 }, async () => {
  // LOGINS=a,b BENCH_OUT=file npm run bench: API points, seconds and score per account (fresh crawl).
  for (const login of (process.env.LOGINS ?? "").split(",").filter(Boolean)) {
    const before = await rl();
    const t = Date.now();
    const { evidence, notes } = await collectProfile(login);
    const secs = (Date.now() - t) / 1000;
    const a = assess(evidence, Date.parse(evidence.fetchedAt), notes);
    const after = await rl();
    appendFileSync(process.env.BENCH_OUT ?? "bench.txt", `${login.padEnd(20)} ${String(before - after - 1).padStart(3)} pts ${secs.toFixed(1).padStart(5)}s  score ${a.total}  ${a.dimensions.map((d) => d.score).join("/")}\n`);
  }
});
