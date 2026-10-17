import { isActivePath, NAV_ITEMS } from "@/components/shell/nav-items";

import type { AiTaskKey } from "./models";

/*
 * Where in the ERP an AI cost was spent (Budget & Costs "By place"): the
 * screen it was asked on ("AI › Chat", "Help Center", the bot), else the page
 * of the record it was about ("Production › Projects"), else the screen the
 * task's work belongs to; work with none of these is "in the background" of
 * its area. Screens of one kind (every order's page) count as one place; the
 * lines link to each record. Plain data and functions.
 */

/** The screen a task's work belongs to, for lines without a screen or a record. */
export const TASK_SCREENS: Partial<Record<AiTaskKey, string>> = {
  "order.plan": "/ai/orders",
  "message.draft": "/ai/drafts",
  "report.daily": "/ai",
  chat: "/ai/chat",
  "server.health": "/ai/health",
  "knowledge.test": "/ai/knowledge",
  "bot.command": "bot",
  "help.answer": "/help",
  "booking.check": "/production/bookings",
  "techpack.draft": "/tech-packs",
};

/** A part of an address that names one record (a cuid, a uuid, a long number). */
function isRecordPart(part: string): boolean {
  if (/^c[a-z0-9]{20,}$/.test(part)) return true;
  if (/^[0-9a-f-]{20,}$/i.test(part)) return true;
  return part.length >= 12 && /\d/.test(part);
}

/** The screen's kind: its address with the record parts as "[id]" ("/sales/orders/[id]"). */
export function screenPattern(path: string): string {
  if (path === "bot") return "bot";
  const parts = path
    .split(/[?#]/)[0]!
    .split("/")
    .filter(Boolean)
    .map((p) => (isRecordPart(p) ? "[id]" : p));
  return `/${parts.join("/")}`;
}

const wordsOf = (part: string) => {
  let text = part;
  try {
    text = decodeURIComponent(part);
  } catch {
    // Kept as it is.
  }
  text = text.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** A screen in words: its menu area, then the parts under it ("Production › Projects › Tech pack"). */
export function screenName(path: string): string {
  if (path === "bot") return "The bot";
  const pattern = screenPattern(path);
  if (pattern === "/help" || pattern.startsWith("/help/")) return "Help Center";
  const entry = NAV_ITEMS.filter((item) => isActivePath(pattern, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  const rest = (entry ? pattern.slice(entry.href === "/" ? 1 : entry.href.length) : pattern)
    .split("/")
    .filter((p) => p && p !== "[id]")
    .map(wordsOf);
  return [entry?.label ?? "ERP", ...rest].join(" › ");
}

export type CostPlace = {
  /** The screen's kind ("/sales/orders/[id]"), "bot", or "area:<module>". */
  key: string;
  label: string;
  /** The screen itself, when it is one page (not one record's). */
  href: string | null;
};

/**
 * The place of one cost line. `recordPage` is the record's page as this
 * person may open it (recordHref), or null.
 */
export function placeOf(
  line: { screen: string | null; task: string; module: string },
  recordPage: string | null,
): CostPlace {
  const path =
    line.screen ?? recordPage?.split(/[?#]/)[0] ?? TASK_SCREENS[line.task as AiTaskKey] ?? null;
  if (!path) {
    return { key: `area:${line.module}`, label: `${line.module} (in the background)`, href: null };
  }
  const pattern = screenPattern(path);
  return {
    key: pattern,
    label: screenName(pattern),
    href: pattern === "bot" || pattern.includes("[id]") ? null : pattern,
  };
}
