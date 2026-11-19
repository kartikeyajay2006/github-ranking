import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const ASSET_ROOT = resolve(process.cwd(), "docs/assets");
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string[] }> }) {
  const { asset } = await params;
  const path = resolve(ASSET_ROOT, ...asset);
  if (!path.startsWith(ASSET_ROOT + sep) || !MIME[extname(path)]) return new Response("Not found", { status: 404 });

  try {
    const file = await readFile(path);
    return new Response(new Uint8Array(file), {
      headers: { "Content-Type": MIME[extname(path)]!, "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
