import "server-only";
import { dataVersion, getSummaries, jobNames, listTeams } from "./store";
import { scoreTeam } from "./teamscore";
import { importScores } from "./imports/jobs";
import type { Band } from "./types";
import type { ProfileSummary, Team } from "./types";

export interface TeamStanding {
  team: Team;
  members: { login: string; profile: ProfileSummary | null }[];
  result: ReturnType<typeof scoreTeam>;
  updated: number;
}

let cache: { version: number; rows: TeamStanding[]; firstAt: Map<number, number>; imports: Map<string, string> } | null = null;

/**
 * Every team scored and sorted. Rebuilding this for thousands of teams costs a few hundred
 * milliseconds, so the result is reused until the database changes (any write moves dataVersion).
 */
export function teamStandings() {
  const version = dataVersion();
  if (cache && cache.version === version) return cache;
  const teams = listTeams();
  const profiles = getSummaries([...new Set(teams.flatMap((t) => t.members.map((m) => m.login)))]);
  // Imported teams are ranked on their import score (GitHub profile + best project), the same number the
  // import page and CSV show; the dimension profile still comes from members' GitHub assessments.
  const imported = importScores();
  const rows = teams
    .map((team) => {
      const members = team.members.map((m) => ({ login: m.login, profile: profiles.get(m.login.toLowerCase()) ?? null }));
      let result = scoreTeam(team, profiles);
      const ranked = imported.get(team.id);
      if (ranked && result) result = { ...result, total: ranked.score, band: (ranked.band as Band) ?? result.band };
      return { team, members, result, updated: Math.max(0, ...members.map((m) => m.profile?.analyzedAt ?? 0)) };
    })
    .sort((a, b) => (b.result?.total ?? -1) - (a.result?.total ?? -1) || a.team.name.localeCompare(b.team.name));
  // Competition ranking (1, 1, 3): the first position of each score.
  const firstAt = new Map<number, number>();
  rows.forEach((r, i) => {
    if (r.result && !firstAt.has(r.result.total)) firstAt.set(r.result.total, i + 1);
  });
  cache = { version, rows, firstAt, imports: jobNames() };
  return cache;
}
