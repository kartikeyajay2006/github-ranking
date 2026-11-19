import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { DOC_PAGES, docContent, docPage } from "@/lib/docs/catalog";
import { DocsReader, type DocHeading } from "@/components/docs-reader";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.map(({ slug }) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

function makeHeadingId(heading: string) {
  return heading.replace(/[`*_~]/g, "").replace(/[^\p{L}\p{N} -]/gu, "").trim().toLowerCase().replace(/\s+/g, "-");
}

async function getArticle(slug: string) {
  const page = docPage(slug);
  if (!page) return null;
  const usedIds = new Map<string, number>();
  const uniqueHeadingId = (heading: string) => {
    const base = makeHeadingId(heading);
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
  let markdown = await docContent(page);
  markdown = markdown
    .replaceAll("../README.md", "/docs")
    .replaceAll("../assets/", "/docs/assets/")
    .replaceAll("../reference/repository-structure.md", "/docs/repository-structure")
    .replaceAll("../reference/data-model-and-api.md", "/docs/data-model-and-api")
    .replaceAll("../reference/contributor-workflow.md", "/docs/contributor-workflow")
    .replaceAll("../guides/full-guide.md", "/docs/full-guide")
    .replaceAll("../guides/app-handbook.md", "/docs/app-handbook")
    .replaceAll("../guides/scoring-reference.md", "/docs/scoring-reference")
    .replaceAll("../guides/imports-and-ranking.md", "/docs/imports-and-ranking")
    .replaceAll("../guides/operations.md", "/docs/operations")
    .replaceAll("../src/app/method/page.tsx", "https://github.com/kartikeyajay2006/github-ranking/blob/main/src/app/method/page.tsx");
  const sourceHeadings = [...markdown.matchAll(/^(#{2,6})\s+(.+)$/gm)];
  const headingIds = sourceHeadings.map((match) => uniqueHeadingId(match[2]!));
  const headings: DocHeading[] = sourceHeadings.flatMap((match, index) =>
    match[1]!.length <= 3
      ? [{ id: headingIds[index]!, label: match[2]!.replace(/[`*_~]/g, ""), level: match[1]!.length as 2 | 3 }]
      : [],
  );
  let headingIndex = 0;
  markdown = markdown.replace(/^(#{2,6})\s+(.+)$/gm, (_line, hashes: string, heading: string) => `${hashes} <span id="${headingIds[headingIndex++]}">${heading}</span>`);
  const html = marked.parse(markdown, { gfm: true }) as string;
  return { page, html, headings };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getArticle((await params).slug);
  return { title: article?.page.title ?? "Documentation" };
}

export default async function DocsArticlePage({ params }: Props) {
  const article = await getArticle((await params).slug);
  if (!article) notFound();
  const { page, html, headings } = article;

  return (
    <div className="wrap docs-reading">
      <nav className="docs-breadcrumbs" aria-label="Breadcrumb">
        <Link href="/docs">Documentation</Link><span aria-hidden="true">/</span><span>{page.group}</span>
      </nav>
      <header className="docs-article-head" data-color={page.color}>
        <p className="kicker">{page.group} reference</p>
        <h1>{page.title}</h1>
        <p className="lede">{page.summary}</p>
      </header>
      <DocsReader html={html} headings={headings} />
      <footer className="docs-article-foot">
        <Link className="btn ghost small" href="/docs">← All documentation</Link>
        <span className="muted">Keep this page in sync with the code it describes.</span>
      </footer>
    </div>
  );
}
