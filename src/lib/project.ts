import "server-only";
import { collectProject } from "./github/collect";
import { assessProject, parseProjectRef, type ProjectAssessment, type ProjectEvidence } from "./scoring/project";
import { getProjectEvidence, saveProjectEvidence } from "./store";

const TTL_MS = Math.max(0, Number(process.env.ANALYSIS_TTL_HOURS ?? 12)) * 3_600_000;

export type ProjectResult =
  | { ok: true; assessment: ProjectAssessment; link: string }
  | { ok: false; reason: string; link: string | null };

/**
 * Grades the best project a person named. Links that aren't a public GitHub repository give no project
 * score (the person is then scored on their GitHub profile alone, unless the import says otherwise).
 * Rate-limit and auth errors are thrown so the queue can wait; anything else is reported as a reason.
 */
export async function analyzeProject(login: string, link: string | null | undefined): Promise<ProjectResult> {
  const ref = parseProjectRef(link);
  if ("problem" in ref) {
    return {
      ok: false,
      link: link ?? null,
      reason: ref.problem === "missing" ? "No best project given" : "Best project link isn't a GitHub repository",
    };
  }
  const key = `${login}|${ref.owner}/${ref.name}`;
  let evidence = getProjectEvidence<ProjectEvidence>(key, TTL_MS);
  if (!evidence) {
    evidence = await collectProject(login, ref.owner, ref.name);
    if (!evidence) return { ok: false, link: link ?? null, reason: `${ref.owner}/${ref.name} isn't a public repository (or doesn't exist)` };
    saveProjectEvidence(key, evidence);
  }
  return { ok: true, assessment: assessProject(evidence), link: link! };
}
