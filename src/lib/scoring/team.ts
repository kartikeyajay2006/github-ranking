import type { Assessment, Band, DimensionKey, WeightingMode } from "../types";
import { DIMENSION_LABELS, DIMENSION_WEIGHTS, bandFor, orientationFor } from "./individual";
import { round1 } from "./curves";

/** A team lead's share is 1.2× an equal share: 2 members → 60/40, 3 → 40/30/30, 4 → 30/23.3×3, 5 → 24/19×4. */
export const LEADER_FACTOR = 1.2;

/**
 * Member weights in input order. One member always carries 100%. Without a designated lead, or in
 * equal mode, every member carries 1/n.
 */
export function teamWeights(logins: string[], leader: string | null, mode: WeightingMode): number[] {
  const n = logins.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const leadIndex = leader ? logins.findIndex((l) => l.toLowerCase() === leader.toLowerCase()) : -1;
  if (mode === "equal" || leadIndex < 0) return logins.map(() => 1 / n);
  const lead = Math.min(1, LEADER_FACTOR / n);
  const rest = (1 - lead) / (n - 1);
  return logins.map((_, i) => (i === leadIndex ? lead : rest));
}

export interface TeamMemberResult {
  login: string;
  weight: number;
  score: number;
  contribution: number;
  isLeader: boolean;
}

export interface TeamAssessment {
  total: number;
  band: Band;
  dimensions: { key: DimensionKey; label: string; weight: number; score: number }[];
  members: TeamMemberResult[];
  pending: string[];
  externalShare: number;
  orientation: ReturnType<typeof orientationFor>;
}

/**
 * Combines members' independent assessments. Each member is scored on their own evidence first; the
 * team only weights the finished scores, so no member's assessment is influenced by a teammate's.
 */
export function assessTeam(
  members: { login: string; assessment: Assessment | null }[],
  leader: string | null,
  mode: WeightingMode,
): TeamAssessment | null {
  const ready = members.filter((m): m is { login: string; assessment: Assessment } => !!m.assessment);
  const pending = members.filter((m) => !m.assessment).map((m) => m.login);
  if (!ready.length) return null;

  const weights = teamWeights(
    ready.map((m) => m.login),
    leader,
    mode,
  );
  const results: TeamMemberResult[] = ready.map((m, i) => {
    const w = weights[i] ?? 0;
    return {
      login: m.login,
      weight: w,
      score: m.assessment.total,
      contribution: w * m.assessment.total,
      isLeader: !!leader && m.login.toLowerCase() === leader.toLowerCase(),
    };
  });

  const keys = Object.keys(DIMENSION_WEIGHTS) as DimensionKey[];
  const dimensions = keys.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    weight: DIMENSION_WEIGHTS[key],
    score: round1(ready.reduce((s, m, i) => s + (weights[i] ?? 0) * (m.assessment.dimensions.find((d) => d.key === key)?.score ?? 0), 0)),
  }));

  const own = ready.reduce((s, m, i) => s + (weights[i] ?? 0) * m.assessment.split.own, 0);
  const external = ready.reduce((s, m, i) => s + (weights[i] ?? 0) * m.assessment.split.external, 0);
  const total = round1(results.reduce((s, r) => s + r.contribution, 0));

  return {
    total,
    band: bandFor(total),
    dimensions,
    members: results,
    pending,
    externalShare: own + external ? external / (own + external) : 0,
    orientation: orientationFor(own, external),
  };
}
