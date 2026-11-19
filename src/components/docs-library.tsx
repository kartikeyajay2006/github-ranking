"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DocPage } from "@/lib/docs/catalog";

export function DocsLibrary({ pages }: { pages: DocPage[] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All topics");
  const groups = ["All topics", ...new Set(pages.map((page) => page.group))];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages.filter((page) => (group === "All topics" || page.group === group) && (!q || `${page.title} ${page.summary} ${page.group}`.toLowerCase().includes(q)));
  }, [group, pages, query]);
  const visibleGroups = [...new Set(filtered.map((page) => page.group))];

  return (
    <div className="docs-library">
      <div className="docs-filter-bar">
        <label className="docs-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search documentation</span>
          <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search guides, topics, and tools…" />
        </label>
        <span className="docs-result-count" aria-live="polite">{filtered.length} {filtered.length === 1 ? "guide" : "guides"}</span>
      </div>
      <div className="docs-topic-filters" aria-label="Filter documentation by topic">
        {groups.map((item) => (
          <button className={group === item ? "docs-topic active" : "docs-topic"} type="button" aria-pressed={group === item} key={item} onClick={() => setGroup(item)}>
            {item}
          </button>
        ))}
      </div>
      {visibleGroups.length ? visibleGroups.map((item) => (
        <section className="docs-group" key={item} aria-labelledby={`docs-${item.toLowerCase().replace(/\s+/g, "-")}`}>
          <div className="docs-group-head">
            <p className="kicker">Library · {item}</p>
            <h2 id={`docs-${item.toLowerCase().replace(/\s+/g, "-")}`}>{item} documentation</h2>
          </div>
          <div className="docs-cards">
            {filtered.filter((page) => page.group === item).map((page) => (
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
      )) : (
        <div className="docs-no-results">
          <span aria-hidden="true">✳</span>
          <h2>No guide found</h2>
          <p>Try a different word or choose another topic.</p>
          <button type="button" className="btn ghost small" onClick={() => { setGroup("All topics"); setQuery(""); }}>Clear filters</button>
        </div>
      )}
    </div>
  );
}
