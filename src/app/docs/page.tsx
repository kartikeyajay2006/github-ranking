import type { Metadata } from "next";
import { DOC_PAGES } from "@/lib/docs/catalog";
import { DocsLibrary } from "@/components/docs-library";

export const metadata: Metadata = { title: "Documentation" };

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

      <DocsLibrary pages={DOC_PAGES} />
    </div>
  );
}
