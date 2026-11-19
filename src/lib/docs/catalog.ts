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
  {
    slug: "app-handbook",
    title: "App handbook",
    group: "Product",
    summary: "A page-by-page tour of Individuals, Teams, Upload, Method, Docs, and the app's visual controls.",
    color: 2,
    file: "guides/app-handbook.md",
  },
  {
    slug: "scoring-reference",
    title: "Scoring reference",
    group: "Scoring",
    summary: "How the six dimensions, bands, projects, teams, missing evidence, and fixed curves fit together.",
    color: 7,
    file: "guides/scoring-reference.md",
  },
  {
    slug: "imports-and-ranking",
    title: "Imports and competitions",
    group: "Imports",
    summary: "Supported files, extraction behavior, policies, background queue, warnings, exports, and troubleshooting.",
    color: 4,
    file: "guides/imports-and-ranking.md",
  },
  {
    slug: "operations",
    title: "Operations handbook",
    group: "Operations",
    summary: "Environment variables, access control, SQLite backups, Docker, Render, monitoring, and recovery.",
    color: 8,
    file: "guides/operations.md",
  },
  {
    slug: "data-model-and-api",
    title: "Data model and HTTP reference",
    group: "Contributors",
    summary: "SQLite tables, migrations, cache behavior, route contracts, authentication, and CSV schemas.",
    color: 6,
    file: "reference/data-model-and-api.md",
  },
  {
    slug: "contributor-workflow",
    title: "Contributor workflow",
    group: "Contributors",
    summary: "Practical checklists for scoring, imports, persistence, interface changes, docs, and release hygiene.",
    color: 3,
    file: "reference/contributor-workflow.md",
  },
];

export function docPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export async function docContent(page: DocPage): Promise<string> {
  return readFile(join(process.cwd(), "docs", page.file), "utf8");
}
