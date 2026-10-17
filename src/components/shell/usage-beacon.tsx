"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/*
 * Counts how the ERP is used, for Bug Guard's product checks
 * (modules/bug-guard/usage.ts): each screen opened, and a form someone typed
 * into (two fields or more) and left without saving. For these only the
 * screen's address goes to the server, made a pattern there; never what was
 * typed in the form. Search boxes and filters do not count as forms. The one
 * exception: words searched in Help that found nothing are sent as typed
 * (components/help/help-search.tsx), for the owner to see in Bug Guard.
 */

const MIN_FIELDS = 2;

type Use = { kind: "VIEW" | "ABANDONED" | "HELP_MISS"; subject: string };

/** Sends one count without holding up the screen (or leaving it). */
export function sendUsage(use: Use) {
  try {
    const body = new Blob([JSON.stringify(use)], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/usage", body)) return;
    void fetch("/api/usage", { method: "POST", body, keepalive: true }).catch(() => undefined);
  } catch {
    // Counting never gets in anyone's way.
  }
}

/** Whether typing in this field counts toward a half-done form. */
export function countsAsForm(form: { role: string | null; method: string }, inputType: string) {
  if (form.role === "search" || form.method.toLowerCase() === "get") return false;
  return !["search", "hidden", "submit", "button", "checkbox", "radio"].includes(inputType);
}

export function UsageBeacon() {
  const pathname = usePathname();
  const dirty = useRef(new Map<HTMLFormElement, Set<string>>());
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const onInput = (event: Event) => {
      const field = event.target as HTMLInputElement | null;
      const form = field?.form ?? field?.closest?.("form");
      if (!field || !form) return;
      if (
        !countsAsForm({ role: form.getAttribute("role"), method: form.method }, field.type ?? "")
      ) {
        return;
      }
      const fields = dirty.current.get(form) ?? new Set<string>();
      fields.add(field.name || field.id || String(fields.size));
      dirty.current.set(form, fields);
    };
    const onSubmit = (event: Event) => dirty.current.delete(event.target as HTMLFormElement);
    const leave = () => {
      const path = shown.current;
      const half = [...dirty.current.values()].some((f) => f.size >= MIN_FIELDS);
      dirty.current.clear();
      if (path && half) sendUsage({ kind: "ABANDONED", subject: path });
    };
    document.addEventListener("input", onInput, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  useEffect(() => {
    // Leaving the last screen with a form half done, then the new one opened.
    const before = shown.current;
    if (before && before !== pathname) {
      const half = [...dirty.current.values()].some((f) => f.size >= MIN_FIELDS);
      dirty.current.clear();
      if (half) sendUsage({ kind: "ABANDONED", subject: before });
    }
    shown.current = pathname;
    sendUsage({ kind: "VIEW", subject: pathname });
  }, [pathname]);

  return null;
}
