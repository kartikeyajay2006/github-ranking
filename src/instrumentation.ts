/** Resumes any bulk import that was running when the server last stopped. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resumeOnBoot } = await import("./lib/imports/worker");
  resumeOnBoot();
}
