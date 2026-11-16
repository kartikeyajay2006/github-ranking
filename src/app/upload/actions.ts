"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiExtractionError, aiAvailable, extractWithClaude } from "@/lib/imports/ai";
import { extract, type Extraction } from "@/lib/imports/extract";
import { createJob, deleteJob, getJob, type LeaderPolicy, type MissingPolicy, reweightJob, retryFailed, setCutoff, setJobStatus, startJob } from "@/lib/imports/jobs";
import type { ProjectMissingPolicy } from "@/lib/scoring/project";
import { MAX_BYTES, ReadError, type DocumentContent, readBytes, readLink } from "@/lib/imports/read";
import { kickWorker } from "@/lib/imports/worker";

export interface UploadState {
  ok: boolean;
  message: string;
}

const MAX_TEAMS = 5000;

export async function previewImport(_prev: UploadState | null, form: FormData): Promise<UploadState> {
  const mode = String(form.get("mode") ?? "file");
  const useAi = form.get("ai") === "on";
  let doc: DocumentContent;
  try {
    if (mode === "link") {
      const link = String(form.get("link") ?? "").trim();
      if (!link) return { ok: false, message: "Paste a link to the document." };
      doc = await readLink(link);
    } else if (mode === "paste") {
      const text = String(form.get("text") ?? "");
      if (!text.trim()) return { ok: false, message: "Paste the document's text." };
      doc = await readBytes(new TextEncoder().encode(text), "pasted.txt");
      doc.label = "Pasted text";
    } else {
      const file = form.get("file");
      if (!(file instanceof File) || !file.name) return { ok: false, message: "Choose a file to upload." };
      if (file.size === 0) return { ok: false, message: `${file.name} is empty.` };
      if (file.size > MAX_BYTES) return { ok: false, message: "Files are limited to 25 MB." };
      doc = await readBytes(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
    }
  } catch (err) {
    if (err instanceof ReadError) return { ok: false, message: err.message };
    console.error(err);
    return { ok: false, message: "The document couldn't be read." };
  }

  let result: Extraction;
  try {
    if (useAi) {
      if (!aiAvailable()) return { ok: false, message: "AI extraction needs ANTHROPIC_API_KEY on the server." };
      result = await extractWithClaude(doc.plain);
    } else result = extract(doc);
  } catch (err) {
    if (err instanceof AiExtractionError) return { ok: false, message: err.message };
    console.error(err);
    return { ok: false, message: "Extraction failed unexpectedly." };
  }

  if (!result.teams.some((t) => t.members.some((m) => m.github)))
    return {
      ok: false,
      message: aiAvailable() && !useAi
        ? "No teams with GitHub accounts were found. Try again with AI extraction turned on."
        : "No teams with GitHub accounts were found in this document.",
    };
  if (result.teams.length > MAX_TEAMS) return { ok: false, message: `Found ${result.teams.length} teams; one import is limited to ${MAX_TEAMS}.` };

  const name = String(form.get("name") ?? "").trim().slice(0, 80) || doc.label.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "Import";
  const id = createJob(name, doc.label, result.method, result.teams);
  revalidatePath("/upload");
  redirect(`/upload/${id}`);
}

export async function startImport(id: string, form: FormData) {
  const job = getJob(id);
  if (!job || job.status !== "draft") return;
  const policy: LeaderPolicy = form.get("policy") === "equal" ? "equal" : "first";
  const cutoffRaw = Number(form.get("cutoff"));
  const missing: MissingPolicy = form.get("missing") === "skip" ? "skip" : "zero";
  startJob(id, {
    policy,
    cutoff: Number.isInteger(cutoffRaw) && cutoffRaw > 0 ? cutoffRaw : null,
    missing,
    projectWeight: projectWeightFrom(form),
    projectMissing: form.get("projectMissing") === "zero" ? "zero" : "github",
    withdrawn: form.get("withdrawn") === "keep" ? "keep" : "skip",
  });
  kickWorker();
  revalidatePath(`/upload/${id}`);
  revalidatePath("/upload");
}

export async function pauseImport(id: string) {
  const job = getJob(id);
  if (job?.status === "running") setJobStatus(id, "paused", "Paused.");
  revalidatePath(`/upload/${id}`);
}

export async function resumeImport(id: string) {
  const job = getJob(id);
  if (job?.status === "paused") {
    setJobStatus(id, "running");
    kickWorker();
  }
  revalidatePath(`/upload/${id}`);
}

export async function retryImport(id: string) {
  retryFailed(id);
  kickWorker();
  revalidatePath(`/upload/${id}`);
}

export async function updateCutoff(id: string, cutoff: number | null) {
  setCutoff(id, cutoff && cutoff > 0 ? Math.floor(cutoff) : null);
  revalidatePath(`/upload/${id}`);
}

export async function removeImport(id: string) {
  deleteJob(id);
  revalidatePath("/upload");
  revalidatePath("/teams");
  redirect("/upload");
}

/** Best-project weight from a form, as a share (the form sends a percentage). */
function projectWeightFrom(form: FormData): number {
  const pct = Number(form.get("projectWeight"));
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) / 100 : 0.3;
}

/** Re-scores every finished team with a new best-project weight; no GitHub calls. */
export async function reweightImport(id: string, form: FormData) {
  if (!getJob(id)) return;
  const missing: ProjectMissingPolicy = form.get("projectMissing") === "zero" ? "zero" : "github";
  reweightJob(id, projectWeightFrom(form), missing);
  revalidatePath(`/upload/${id}`);
}
