"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "/", label: "Individuals", match: (p: string) => p === "/" || p.startsWith("/u/") },
  { href: "/teams", label: "Teams", match: (p: string) => p.startsWith("/teams") },
  { href: "/upload", label: "Upload", match: (p: string) => p.startsWith("/upload") },
  { href: "/docs", label: "Docs", match: (p: string) => p.startsWith("/docs") },
  { href: "/method", label: "Method", match: (p: string) => p.startsWith("/method") },
];

export function Masthead() {
  const path = usePathname();
  return (
    <header className="masthead">
      <div className="wrap">
        <Link href="/" className="wordmark" aria-label="github-ranking home">
          <span className="glyph" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>
            github<span className="full">-ranking</span>
          </span>
        </Link>
        <nav className="nav" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
