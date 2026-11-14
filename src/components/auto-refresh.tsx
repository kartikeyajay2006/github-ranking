"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Everyone shares one database, so lists refresh on their own: what one person adds or removes shows up for
 * the others within a few seconds. Skipped while the tab is hidden or someone has half-typed text in a field.
 */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const el = document.activeElement;
      // Don't refresh under someone who is in the middle of typing.
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value.trim() !== "") return;
      if (document.querySelector("form [aria-busy='true'], button[disabled]")) return;
      router.refresh();
    };
    const timer = setInterval(tick, seconds * 1000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return null;
}
