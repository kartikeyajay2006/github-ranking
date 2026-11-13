import type { ProfileSummary, Team } from "./types";
import { DIMENSION_WEIGHTS } from "./scoring/individual";
import { type MemberScore, assessTeam } from "./scoring/team";

const ZERO: MemberScore = {
  total: 0,
  dimensions: (Object.keys(DIMENSION_WEIGHTS) as (keyof typeof DIMENSION_WEIGHTS)[]).map((key) => ({ key, score: 0 })),
  split: { own: 0, external: 0 },
};

/** A team's score from its members' stored summaries; absent members (no usable GitHub) count as 0. */
export function scoreTeam(team: Team, summaries: Map<string, ProfileSummary>) {
  return assessTeam(
    [
      ...team.members.map((m) => ({ login: m.login, assessment: summaries.get(m.login.toLowerCase()) ?? null })),
      ...team.absent.map((a) => ({ login: a.label, assessment: ZERO })),
    ],
    team.leader,
    team.mode,
  );
}
