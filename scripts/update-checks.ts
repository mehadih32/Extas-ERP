import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/*
 * What the check after an update opens (scripts/check-update.ts): every screen
 * of the app that needs no record picked first, found from the page files
 * themselves so a new screen is checked from the day it is added, and the
 * screens of the newest records, which the database names.
 */

/** The app's screens under src/app/(app): "/production/bookings", "/production/bookings/[bookingId]"... */
export function screenRoutes(appDir: string): string[] {
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "page.tsx") {
        const route = relative(appDir, dir).split(sep).filter(Boolean);
        // Folders in brackets like (app) group screens and are not in the address.
        const shown = route.filter((part) => !/^\(.*\)$/.test(part));
        routes.push(`/${shown.join("/")}`);
      }
    }
  };
  walk(appDir);
  return routes.sort();
}

/** A screen that needs no record picked first ("/production/bookings", not ".../[bookingId]"). */
export const isFixedRoute = (route: string) => !route.includes("[");

/** "/production/bookings/[bookingId]" with the record's id in its place. */
export function fillRoute(route: string, values: Record<string, string>): string | null {
  let missing = false;
  const filled = route.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = values[name];
    if (!value) missing = true;
    return encodeURIComponent(value ?? "");
  });
  return missing ? null : filled;
}

/** Screens that stand between a person and the app, where a screen must not send the check. */
const GATES: Record<string, string> = {
  "/sign-in": "the sign-in screen",
  "/change-password": "the change-password screen",
  "/select-company": "the choose-a-company screen",
  "/terms": "the terms of employment",
};

/**
 * Why an answer is not a working screen, or null when it is one: an error status,
 * the sign-in screen instead of the page, or a page whose server part failed
 * (Next.js then sends the page with an error digest, a number, for the error
 * screen to show; a "not found" or a redirect carries a word there instead).
 */
export function screenProblem(answer: {
  status: number;
  url: string;
  body: string;
}): string | null {
  if (answer.status >= 400) return `answered ${answer.status}`;
  const path = new URL(answer.url).pathname;
  const gate = GATES[path];
  if (gate) return `sent the check to ${gate}`;
  if (/data-dgst=\\?"\d+\\?"/.test(answer.body) || /\\?"digest\\?":\\?"\d+\\?"/.test(answer.body)) {
    return "showed the error screen";
  }
  return null;
}

/** Why a PDF download is not a PDF, or null when it is one. */
export function pdfProblem(answer: {
  status: number;
  type: string;
  bytes: Uint8Array;
}): string | null {
  if (answer.status >= 400) return `answered ${answer.status}`;
  if (!answer.type.startsWith("application/pdf"))
    return `sent ${answer.type || "no file"} instead of a PDF`;
  const head = Buffer.from(answer.bytes.subarray(0, 5)).toString("latin1");
  return head === "%PDF-" ? null : "sent a file that is not a PDF";
}
