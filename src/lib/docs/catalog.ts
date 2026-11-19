import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  summary: string;
  color: number;
  file: string;
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: "full-guide",
    title: "The complete guide",
    group: "Product",
    summary: "How individual and team ranking works, how imports are processed, and how to run the application.",
    color: 1,
    file: "guides/full-guide.md",
  },
  {
    slug: "repository-structure",
    title: "Repository structure",
    group: "Contributors",
    summary: "A directory-by-directory map of the application and the right place for common changes.",
    color: 3,
    file: "reference/repository-structure.md",
  },
  {
    slug: "assets",
    title: "Documentation assets",
    group: "Contributors",
    summary: "Where the project screenshots and generated README illustrations live.",
    color: 5,
    file: "assets/README.md",
  },
];

export function docPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export async function docContent(page: DocPage): Promise<string> {
  return readFile(join(process.cwd(), "docs", page.file), "utf8");
}
