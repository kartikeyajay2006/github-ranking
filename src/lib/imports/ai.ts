import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { type Extraction, type ExtractedTeam, finalise, handleFromCell } from "./extract";

/**
 * Optional extraction with Claude for documents the rule-based reader can't follow (free-form PDFs,
 * prose, unusual layouts). Only runs when the person importing turns it on and a key is configured.
 * The document text is sent to Anthropic's API; nothing about scoring involves the model.
 */

export const aiAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

const MODEL = "claude-opus-5-5";
const CHUNK_CHARS = 24_000;
const CONCURRENCY = 3;

const TeamsSchema = z.object({
  teams: z.array(
    z.object({
      name: z.string(),
      members: z.array(
        z.object({
          name: z.string().nullable(),
          email: z.string().nullable(),
          github: z.string().nullable(),
          is_leader: z.boolean(),
        }),
      ),
    }),
  ),
});

const SYSTEM = `You extract hackathon team registrations from documents for an organiser who will rank the teams.

For every team in the document excerpt, return its name and every member: their name, e-mail and GitHub account, and whether they are the team leader.

Rules:
- Copy names and e-mails exactly as written. Never invent or guess values; use null when a field is absent.
- github is the account username only (for https://github.com/alice it is "alice"). A link to a repository (github.com/owner/repo) is a project, not a person: don't use it as anyone's GitHub.
- Mark is_leader only for someone the document identifies as leader, lead, captain or point of contact.
- Include every team in the excerpt, even one that starts or ends at the edge of the excerpt.
- If the excerpt contains no teams, return an empty list.`;

function chunks(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > CHUNK_CHARS) {
    // Prefer to cut just before a "Team" heading, else at a blank line, else at a line break.
    const window = rest.slice(0, CHUNK_CHARS);
    const at = Math.max(window.search(/\n\s*\W{0,4}team\b[^\n]*$/im), window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    const cut = at > CHUNK_CHARS / 2 ? at : CHUNK_CHARS;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

export class AiExtractionError extends Error {}

async function extractChunk(client: Anthropic, excerpt: string, part: number, total: number): Promise<ExtractedTeam[]> {
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: zodOutputFormat(TeamsSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Document excerpt ${part} of ${total}:\n\n<document>\n${excerpt}\n</document>` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiExtractionError("The Anthropic API key was rejected.");
    if (err instanceof Anthropic.RateLimitError) throw new AiExtractionError("Anthropic's rate limit was reached. Try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new AiExtractionError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new AiExtractionError("The model declined to process part of this document.");
  if (response.stop_reason === "max_tokens") throw new AiExtractionError("Part of the document was too dense to extract in one pass. Split the file and import it in parts.");
  const parsed = response.parsed_output;
  if (!parsed) throw new AiExtractionError("The model's answer couldn't be read.");
  return parsed.teams.map((t) => ({
    name: t.name.trim() || "Unnamed team",
    members: t.members.map((m) => ({
      name: m.name?.trim() || null,
      email: m.email?.trim().toLowerCase() || null,
      github: m.github ? handleFromCell(m.github) : null,
      leader: m.is_leader,
    })),
    warnings: [],
  }));
}

export async function extractWithClaude(text: string): Promise<Extraction> {
  const client = new Anthropic();
  const parts = chunks(text);
  const results: ExtractedTeam[][] = new Array(parts.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, parts.length) }, async () => {
      while (next < parts.length) {
        const i = next++;
        results[i] = await extractChunk(client, parts[i]!, i + 1, parts.length);
      }
    }),
  );
  // A team cut by a chunk boundary appears twice with the same name: merge them.
  const merged = new Map<string, ExtractedTeam>();
  for (const team of results.flat()) {
    const key = team.name.toLowerCase();
    const existing = merged.get(key);
    if (existing && parts.length > 1) existing.members.push(...team.members);
    else merged.set(merged.has(key) ? `${key}#${merged.size}` : key, team);
  }
  return { teams: finalise([...merged.values()]), method: "ai", warnings: [] };
}
