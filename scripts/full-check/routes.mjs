// The ERP's screens, found from the page files in src/app (shared by the Full
// check, crawl.mjs, and the layout checks, layout-run.mjs).

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Every screen's address pattern, from the page files ("/production/projects/[projectId]"). */
export function screenRoutes(dir) {
  const routes = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) {
        if (name !== "api") walk(path);
      } else if (name === "page.tsx") {
        const parts = relative(dir, d)
          .split(sep)
          .filter(Boolean)
          .filter((p) => !/^\(.*\)$/.test(p));
        routes.push(`/${parts.join("/")}`);
      }
    }
  };
  walk(dir);
  return routes.sort();
}

/** A finder for the pattern an address belongs to ("/sales/orders/x1" -> "/sales/orders/[id]"). */
export function patternFinder(routes) {
  const patterns = routes.map((route) => ({
    route,
    dynamic: route.includes("["),
    re: new RegExp(`^${route.replace(/\[\.\.\.[^\]]+\]/g, ".+").replace(/\[[^\]]+\]/g, "[^/]+")}$`),
  }));
  return (path) => {
    const fixed = patterns.find((p) => !p.dynamic && p.route === path);
    if (fixed) return fixed.route;
    const all = patterns.filter((p) => p.re.test(path));
    all.sort((a, b) => a.route.split("[").length - b.route.split("[").length);
    return all[0]?.route ?? null;
  };
}

/** Screens anyone may open without signing in. */
export const PUBLIC = new Set([
  "/sign-in",
  "/forgot-password",
  "/reset-password",
  "/sign-up",
  "/invite",
]);

/** Screens a person is sent to before the others: they must act there first. */
export const GATES = {
  "/sign-in": "sign in",
  "/change-password": "change their password",
  "/select-company": "choose a company",
  "/terms": "accept the terms of employment",
};

/** Links that would change something, sign out, or leave the ERP. */
export const NEVER = [
  /^\/sign-out/,
  /^\/logout/,
  /^\/api\/auth\//,
  /\/(send|delete|approve|cancel|void|merge|restore)(\/|$|\?)/,
];
