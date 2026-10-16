"use client";

import { useEffect } from "react";

/** Text the app cuts short with "..." (Tailwind's truncate and line-clamp). */
const CUT = ".truncate, [class*='line-clamp-']";

/**
 * Text cut short with "..." shows the whole of it as a tooltip when the pointer is
 * over it or it has the keyboard's focus, anywhere in the app: a long buyer's name in
 * a table, a note, an address. Nothing is drawn; it gives the cut text a title.
 */
export function TruncatedTitles() {
  useEffect(() => {
    const show = (event: Event) => {
      const target = event.target;
      const el = target instanceof Element ? target.closest(CUT) : null;
      if (!(el instanceof HTMLElement) || el.hasAttribute("title")) return;
      const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (!cut) return;
      const text = el.innerText.replace(/\s+/g, " ").trim();
      if (text) el.setAttribute("title", text);
    };
    document.addEventListener("pointerover", show, { passive: true });
    document.addEventListener("focusin", show);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
    };
  }, []);
  return null;
}
