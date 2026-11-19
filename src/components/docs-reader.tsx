"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export interface DocHeading {
  id: string;
  label: string;
  level: 2 | 3;
}

export function DocsReader({ html, headings }: { html: string; headings: DocHeading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const [size, setSize] = useState<"small" | "regular" | "large">("regular");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const updateProgress = () => {
      const article = document.querySelector<HTMLElement>(".docs-markdown");
      if (!article) return;
      const distance = article.offsetTop;
      const range = Math.max(1, article.offsetHeight - window.innerHeight * 0.72);
      setProgress(Math.min(100, Math.max(0, ((window.scrollY - distance + 80) / range) * 100)));
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target.id) setActive(visible[0].target.id);
    }, { rootMargin: "-12% 0px -76% 0px", threshold: 0 });
    headings.forEach(({ id }) => {
      const heading = document.getElementById(id);
      if (heading) observer.observe(heading);
    });
    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
      observer.disconnect();
    };
  }, [headings]);

  useEffect(() => {
    const blocks = [...document.querySelectorAll<HTMLElement>(".docs-markdown pre")];
    const buttons = blocks.map((block, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "docs-copy-code";
      button.textContent = "Copy";
      button.setAttribute("aria-label", `Copy code example ${index + 1}`);
      button.addEventListener("click", async () => {
        const text = block.querySelector("code")?.innerText ?? block.innerText;
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = "Copied ✓";
          setCopied(`Example ${index + 1} copied`);
          window.setTimeout(() => { button.textContent = "Copy"; }, 1600);
        } catch {
          button.textContent = "Select code";
          setCopied("Clipboard access is unavailable; select the example to copy it.");
        }
      });
      block.append(button);
      return button;
    });
    return () => buttons.forEach((button) => button.remove());
  }, [html]);

  return (
    <>
      <div className="docs-progress-track" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="docs-reading-layout">
        <aside className="docs-reader-side">
          <div className="docs-reader-controls" aria-label="Reading controls">
            <span>Text size</span>
            <div>
              <button type="button" aria-label="Smaller text" aria-pressed={size === "small"} onClick={() => setSize("small")}>A−</button>
              <button type="button" aria-label="Comfortable text" aria-pressed={size === "regular"} onClick={() => setSize("regular")}>A</button>
              <button type="button" aria-label="Larger text" aria-pressed={size === "large"} onClick={() => setSize("large")}>A+</button>
            </div>
          </div>
          <nav className="docs-toc" aria-label="On this page">
            <p>On this page</p>
            {headings.map((heading) => (
              <Link className={`${heading.level === 3 ? "sub" : ""}${active === heading.id ? " active" : ""}`} href={`#${heading.id}`} key={heading.id} aria-current={active === heading.id ? "location" : undefined}>
                {heading.label}
              </Link>
            ))}
            {!headings.length && <span className="muted">Guide sections</span>}
          </nav>
          <Link className="docs-back-link" href="/docs">← Documentation home</Link>
        </aside>
        <article className="docs-markdown" data-size={size} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <span className="sr-only" aria-live="polite">{copied}</span>
    </>
  );
}
