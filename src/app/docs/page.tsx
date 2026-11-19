import type { Metadata } from "next";
import Link from "next/link";
import { DOC_PAGES } from "@/lib/docs/catalog";

export const metadata: Metadata = { title: "Documentation" };

const groups = [...new Set(DOC_PAGES.map((page) => page.group))];

export default function DocsPage() {
  return (
    <div className="wrap docs-home">
      <header className="docs-hero">
        <p className="kicker">Project field guide</p>
        <h1>Understand the work.<br /><span>Find your way around.</span></h1>
        <p className="lede">Product guides, contributor maps, and operational notes for github-ranking, gathered in one place.</p>
        <div className="docs-pills" aria-label="Documentation themes">
          <span>🟦 Product</span><span>🟩 Contributors</span><span>🟨 Operations</span><span>🟪 Method</span>
        </div>
      </header>

      {groups.map((group) => (
        <section className="docs-group" key={group} aria-labelledby={`docs-${group.toLowerCase()}`}>
          <div className="docs-group-head">
            <p className="kicker">Library · {group}</p>
            <h2 id={`docs-${group.toLowerCase()}`}>{group} documentation</h2>
          </div>
          <div className="docs-cards">
            {DOC_PAGES.filter((page) => page.group === group).map((page) => (
              <Link className="docs-card" data-color={page.color} href={`/docs/${page.slug}`} key={page.slug}>
                <span className="docs-card-mark" aria-hidden="true">✳</span>
                <span className="docs-card-group">{page.group}</span>
                <h3>{page.title}</h3>
                <p>{page.summary}</p>
                <span className="docs-card-link">Read this guide <span aria-hidden="true">↗</span></span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <aside className="docs-note">
        <span aria-hidden="true">✦</span>
        <p><strong>Rules stay connected.</strong> When the implementation changes, update the relevant guide and the public methodology at the same time.</p>
        <Link className="btn ghost small" href="/method">Open methodology</Link>
      </aside>
    </div>
  );
}
