import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ENDPOINT = "https://api.github.com/graphql";
const run = promisify(execFile);

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "auth" | "rate_limited" | "upstream" | "invalid",
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

let cachedToken: string | null = null;

async function token(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (cachedToken) return cachedToken;
  try {
    const { stdout } = await run("gh", ["auth", "token"], { timeout: 5000 });
    const value = stdout.trim();
    if (value) {
      cachedToken = value;
      return value;
    }
  } catch {
    /* fall through */
  }
  throw new GitHubError(
    "No GitHub token configured. Set GITHUB_TOKEN or sign in with the GitHub CLI (`gh auth login`).",
    "auth",
  );
}

export interface RateLimit {
  remaining: number;
  limit: number;
  resetAt: string;
}

let lastRateLimit: RateLimit | null = null;

/** GitHub penalises bursts of concurrent requests (secondary limits), so every call queues through this gate. */
const MAX_IN_FLIGHT = 6;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const rateLimitSnapshot = () => lastRateLimit;

interface GraphQLResponse<T> {
  data?: T & { rateLimit?: RateLimit };
  errors?: { type?: string; message: string; path?: (string | number)[] }[];
}

/**
 * Runs a GraphQL query. Partial data is returned alongside per-path errors because GitHub reports
 * missing repositories or unreadable blobs as errors while still answering the rest of the query.
 * 502/504 (GitHub's response to an expensive query) is retried once, then surfaced so callers can
 * shrink the query.
 */
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<{ data: T; errors: NonNullable<GraphQLResponse<T>["errors"]> }> {
  await acquire();
  try {
    return await request<T>(query, variables, options);
  } finally {
    release();
  }
}

async function request<T>(
  query: string,
  variables: Record<string, unknown>,
  { retries = 1, timeoutMs = 30_000 }: { retries?: number; timeoutMs?: number },
): Promise<{ data: T; errors: NonNullable<GraphQLResponse<T>["errors"]> }> {
  const auth = await token();
  let throttled = 0;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `bearer ${auth}`,
          "Content-Type": "application/json",
          "User-Agent": "github-ranking",
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name === "TimeoutError") {
        if (attempt < retries) continue;
        throw new GitHubError("GitHub did not answer in time.", "upstream");
      }
      throw new GitHubError(`Could not reach GitHub: ${(err as Error).message}`, "upstream");
    }

    if (res.status === 401) throw new GitHubError("GitHub rejected the token (401).", "auth");
    if (res.status === 403 || res.status === 429) {
      const primary = res.headers.get("x-ratelimit-remaining") === "0";
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      // Secondary limits clear quickly: honour retry-after, otherwise back off 3s, 9s, 27s.
      if (!primary && throttled < 3) {
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 3000 * 3 ** throttled);
        throttled++;
        attempt--;
        continue;
      }
      const reset = res.headers.get("x-ratelimit-reset");
      const when = reset ? new Date(Number(reset) * 1000).toISOString().slice(11, 16) + " UTC" : "a minute";
      throw new GitHubError(`GitHub rate limit reached. Try again after ${when}.`, "rate_limited");
    }
    if (res.status >= 500) {
      if (attempt < retries) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      throw new GitHubError(`GitHub returned ${res.status} for an expensive query.`, "upstream");
    }
    if (!res.ok) throw new GitHubError(`GitHub returned ${res.status}.`, "upstream");

    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.data?.rateLimit) lastRateLimit = body.data.rateLimit;
    const errors = body.errors ?? [];
    if (!body.data) {
      const first = errors[0];
      if (first?.type === "RATE_LIMITED") throw new GitHubError("GitHub rate limit reached.", "rate_limited");
      throw new GitHubError(first?.message ?? "Empty response from GitHub.", "upstream");
    }
    return { data: body.data, errors };
  }
}
