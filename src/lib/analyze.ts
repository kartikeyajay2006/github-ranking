import "server-only";
import { GitHubError } from "./github/client";
import { collectProfile, normaliseLogin } from "./github/collect";
import { METHODOLOGY_VERSION, assess } from "./scoring/individual";
import { getProfile, saveProfile } from "./store";
import type { StoredProfile } from "./types";

const TTL_MS = Math.max(0, Number(process.env.ANALYSIS_TTL_HOURS ?? 12)) * 3_600_000;

/** In-flight analyses, so two requests for the same login share one GitHub crawl. */
const inFlight = new Map<string, Promise<StoredProfile>>();

/**
 * Analyses one account in isolation: collect its evidence, score it against fixed thresholds, store
 * the snapshot. Reuses a stored snapshot while it is fresh and on the current methodology.
 */
export async function analyze(rawLogin: string, { force = false } = {}): Promise<StoredProfile> {
  const login = normaliseLogin(rawLogin);
  if (!login) throw new GitHubError(`"${rawLogin}" is not a valid GitHub username.`, "invalid");

  if (!force) {
    const existing = getProfile(login);
    if (existing && existing.assessment.methodology === METHODOLOGY_VERSION && Date.now() - existing.analyzedAt < TTL_MS)
      return existing;
  }

  const key = login.toLowerCase();
  const pending = inFlight.get(key);
  if (pending) return pending;

  const job = (async () => {
    const { evidence, notes } = await collectProfile(login);
    const assessment = assess(evidence, Date.parse(evidence.fetchedAt), notes);
    const analyzedAt = Date.now();
    saveProfile(evidence, assessment, analyzedAt);
    return { login: evidence.login, evidence, assessment, analyzedAt } satisfies StoredProfile;
  })();
  inFlight.set(key, job);
  try {
    return await job;
  } finally {
    inFlight.delete(key);
  }
}

export interface BatchResult {
  input: string;
  login?: string;
  ok: boolean;
  message?: string;
}

/** Splits free text ("a, b\nhttps://github.com/c @d") into distinct logins, keeping invalid tokens for reporting. */
export function parseLogins(text: string): { logins: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const logins: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const login = normaliseLogin(token);
    if (!login) invalid.push(token);
    else if (!seen.has(login.toLowerCase())) {
      seen.add(login.toLowerCase());
      logins.push(login);
    }
  }
  return { logins, invalid };
}

/** Analyses several accounts, two at a time. Each one is still collected and scored on its own. */
export async function analyzeMany(logins: string[], opts: { force?: boolean } = {}): Promise<{ results: BatchResult[]; profiles: StoredProfile[] }> {
  const results: BatchResult[] = new Array(logins.length);
  const profiles: StoredProfile[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < logins.length) {
      const i = cursor++;
      const input = logins[i]!;
      try {
        const p = await analyze(input, opts);
        profiles.push(p);
        results[i] = { input, login: p.login, ok: true };
      } catch (err) {
        results[i] = { input, ok: false, message: err instanceof GitHubError ? err.message : "Analysis failed unexpectedly." };
        if (!(err instanceof GitHubError)) console.error(err);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { results, profiles };
}
