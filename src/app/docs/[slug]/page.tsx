import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { DOC_PAGES, docContent, docPage } from "@/lib/docs/catalog";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.map(({ slug }) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

async function getArticle(slug: string) {
  const page = docPage(slug);
  if (!page) return null;
  let markdown = await docContent(page);
  markdown = markdown
    .replaceAll("../README.md", "/docs")
    .replaceAll("../assets/", "/docs/assets/")
    .replaceAll("../reference/repository-structure.md", "/docs/repository-structure")
    .replaceAll("../guides/full-guide.md", "/docs/full-guide")
    .replaceAll("../src/app/method/page.tsx", "https://github.com/kartikeyajay2006/github-ranking/blob/main/src/app/method/page.tsx");
  markdown = markdown.replace(/^(#{2,6})\s+(.+)$/gm, (_line, hashes: string, heading: string) => {
    const id = heading.replace(/[`*_~]/g, "").replace(/[^\p{L}\p{N} -]/gu, "").trim().toLowerCase().replace(/\s+/g, "-");
    return `${hashes} <span id="${id}">${heading}</span>`;
  });
  const html = marked.parse(markdown, { gfm: true }) as string;
  return { page, html };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getArticle((await params).slug);
  return { title: article?.page.title ?? "Documentation" };
}

export default async function DocsArticlePage({ params }: Props) {
  const article = await getArticle((await params).slug);
  if (!article) notFound();
  const { page, html } = article;

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
      <article className="docs-markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <footer className="docs-article-foot">
        <Link className="btn ghost small" href="/docs">← All documentation</Link>
        <span className="muted">Keep this page in sync with the code it describes.</span>
      </footer>
    </div>
  );
}
