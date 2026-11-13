"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { analyze, analyzeMany, parseLogins, type BatchResult } from "@/lib/analyze";
import { GitHubError } from "@/lib/github/client";
import { normaliseLogin } from "@/lib/github/collect";
import * as store from "@/lib/store";
import type { WeightingMode } from "@/lib/types";

export interface FormState {
  ok: boolean;
  message: string;
  results?: BatchResult[];
}

const MAX_PER_SUBMIT = 25;

function summarise(results: BatchResult[], invalid: string[], verb: string): FormState {
  const done = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const all = [...results, ...invalid.map((input) => ({ input, ok: false, message: "Not a valid GitHub username." }))];
  if (!done) return { ok: false, message: failed[0]?.message ?? "Nothing to add.", results: all };
  const tail = failed.length + invalid.length ? ` ${failed.length + invalid.length} could not be added.` : "";
  return { ok: true, message: `${done} ${done === 1 ? "profile" : "profiles"} ${verb}.${tail}`, results: all };
}

/* ------------------------------------------------------------- individuals ------------------------------------------------------------- */

export async function addIndividuals(_prev: FormState | null, form: FormData): Promise<FormState> {
  const { logins, invalid } = parseLogins(String(form.get("logins") ?? ""));
  if (!logins.length) return { ok: false, message: invalid.length ? `"${invalid[0]}" is not a valid GitHub username.` : "Enter at least one GitHub username." };
  if (logins.length > MAX_PER_SUBMIT) return { ok: false, message: `Add at most ${MAX_PER_SUBMIT} profiles at a time.` };

  const { results, profiles } = await analyzeMany(logins);
  for (const p of profiles) store.addIndividual(p.login);
  revalidatePath("/");
  return summarise(results, invalid, "ranked");
}

export async function removeIndividual(login: string) {
  store.removeIndividual(login);
  revalidatePath("/");
  revalidatePath(`/u/${login}`);
}

export async function refreshProfile(login: string): Promise<FormState> {
  try {
    await analyze(login, { force: true });
  } catch (err) {
    return { ok: false, message: err instanceof GitHubError ? err.message : "Refresh failed." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Re-analysed." };
}

export async function enterIndividual(login: string) {
  store.addIndividual(login);
  revalidatePath("/");
  revalidatePath(`/u/${login}`);
}

/* ---------------------------------------------------------------- teams ---------------------------------------------------------------- */

export async function createOrExtendTeam(_prev: FormState | null, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  const mode: WeightingMode = form.get("mode") === "equal" ? "equal" : "leader";
  const leadInput = String(form.get("leader") ?? "").trim();
  const { logins, invalid } = parseLogins(String(form.get("members") ?? ""));

  if (!name) return { ok: false, message: "Give the team a name." };
  if (name.length > 80) return { ok: false, message: "Team names are limited to 80 characters." };
  const leader = leadInput ? normaliseLogin(leadInput) : null;
  if (leadInput && !leader) return { ok: false, message: `"${leadInput}" is not a valid GitHub username for the lead.` };
  if (leader && !logins.some((l) => l.toLowerCase() === leader.toLowerCase())) logins.unshift(leader);
  if (logins.length > MAX_PER_SUBMIT) return { ok: false, message: `Add at most ${MAX_PER_SUBMIT} members at a time.` };

  const existing = store.findTeamByName(name);
  const { results, profiles } = logins.length ? await analyzeMany(logins) : { results: [], profiles: [] };
  if (logins.length && !profiles.length) return summarise(results, invalid, "added");

  const id = existing?.id ?? store.createTeam(name, mode);
  store.addTeamMembers(
    id,
    profiles.map((p) => p.login),
  );
  const leadProfile = leader && profiles.find((p) => p.login.toLowerCase() === leader.toLowerCase());
  if (leadProfile) store.updateTeam(id, { leader: leadProfile.login });
  if (!existing) store.updateTeam(id, { mode });

  revalidatePath("/teams");
  const failures = results.filter((r) => !r.ok).length + invalid.length;
  redirect(`/teams/${id}${failures ? `?skipped=${failures}` : ""}`);
}

export async function addTeamMembers(teamId: string, _prev: FormState | null, form: FormData): Promise<FormState> {
  const team = store.getTeam(teamId);
  if (!team) return { ok: false, message: "This team no longer exists." };
  const { logins, invalid } = parseLogins(String(form.get("members") ?? ""));
  if (!logins.length) return { ok: false, message: invalid.length ? `"${invalid[0]}" is not a valid GitHub username.` : "Enter at least one GitHub username." };
  if (logins.length > MAX_PER_SUBMIT) return { ok: false, message: `Add at most ${MAX_PER_SUBMIT} members at a time.` };

  const { results, profiles } = await analyzeMany(logins);
  store.addTeamMembers(
    teamId,
    profiles.map((p) => p.login),
  );
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
  return summarise(results, invalid, "added");
}

export async function removeTeamMember(teamId: string, login: string) {
  store.removeTeamMember(teamId, login);
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
}

export async function setTeamLeader(teamId: string, login: string | null) {
  store.updateTeam(teamId, { leader: login });
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
}

export async function setTeamMode(teamId: string, mode: WeightingMode) {
  store.updateTeam(teamId, { mode: mode === "equal" ? "equal" : "leader" });
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
}

export async function renameTeam(teamId: string, _prev: FormState | null, form: FormData): Promise<FormState> {
  const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, message: "The name can't be empty." };
  if (name.length > 80) return { ok: false, message: "Team names are limited to 80 characters." };
  const clash = store.findTeamByName(name);
  if (clash && clash.id !== teamId) return { ok: false, message: "Another team already has that name." };
  store.updateTeam(teamId, { name });
  revalidatePath(`/teams/${teamId}`);
  revalidatePath("/teams");
  return { ok: true, message: "Renamed." };
}

export async function refreshTeam(teamId: string): Promise<FormState> {
  const team = store.getTeam(teamId);
  if (!team) return { ok: false, message: "This team no longer exists." };
  const { results } = await analyzeMany(
    team.members.map((m) => m.login),
    { force: true },
  );
  revalidatePath("/", "layout");
  const failed = results.filter((r) => !r.ok);
  return failed.length ? { ok: false, message: `${failed.length} member(s) could not be refreshed: ${failed[0]!.message}` } : { ok: true, message: "All members re-analysed." };
}

export async function deleteTeam(teamId: string) {
  store.deleteTeam(teamId);
  revalidatePath("/teams");
  redirect("/teams");
}
