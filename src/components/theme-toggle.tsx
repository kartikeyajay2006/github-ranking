"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "Auto" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      /* storage unavailable: follow the system */
    }
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={theme === o.value} aria-label={`${o.label} theme`} onClick={() => choose(o.value)}>
          <span className="long">{o.label}</span>
          <span className="short" aria-hidden>
            {o.label[0]}
          </span>
        </button>
      ))}
    </div>
  );
}
