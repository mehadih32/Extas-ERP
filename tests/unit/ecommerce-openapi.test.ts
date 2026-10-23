import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EVENT_TYPES } from "@/modules/ecommerce/webhooks";

/*
 * openapi.yaml (the contract CN-005 asks the ERP to commit) describes every
 * e-commerce route and every webhook the ERP sends, and nothing that is not there.
 */

const root = process.cwd();
const spec = readFileSync(path.join(root, "openapi.yaml"), "utf8");

/** "/orders/{externalOrderId}" -> ["patch"], read from the paths section by indentation. */
function documented(): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  const section = spec.slice(spec.indexOf("\npaths:\n"), spec.indexOf("\nwebhooks:\n"));
  let current: string | null = null;
  for (const line of section.split("\n")) {
    const route = /^ {2}(\/\S*):$/.exec(line);
    if (route) paths.set((current = route[1]!), []);
    const method = /^ {4}(get|post|patch|put|delete):$/.exec(line);
    if (method && current) paths.get(current)!.push(method[1]!);
  }
  return paths;
}

/** The routes in src/app/api/v1/ecommerce with the methods they export. */
function routes(): Map<string, string[]> {
  const base = path.join(root, "src/app/api/v1/ecommerce");
  const found = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const route = path
          .dirname(full)
          .slice(base.length)
          .split(path.sep)
          .join("/")
          .replace(/\[([^\]]+)\]/g, "{$1}");
        const methods = [
          ...readFileSync(full, "utf8").matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g),
        ].map((m) => m[1]!.toLowerCase());
        found.set(route, methods.sort());
      }
    }
  };
  walk(base);
  return found;
}

describe("openapi.yaml", () => {
  it("documents every e-commerce route with its methods, and only those", () => {
    const actual = routes();
    expect(actual.size).toBeGreaterThanOrEqual(11);
    const written = documented();
    expect(new Map([...written].map(([p, m]) => [p, [...m].sort()]))).toEqual(actual);
  });

  it("documents every webhook the ERP sends, signed and with its event id", () => {
    const section = spec.slice(spec.indexOf("\nwebhooks:\n"), spec.indexOf("\ncomponents:\n"));
    for (const type of EVENT_TYPES) expect(section).toContain(`\n  ${type}:\n`);
    expect(section).toContain("X-Extas-Delivery");
    expect(spec).toContain("X-Extas-Signature");
    expect(spec).toContain("Idempotency-Key");
    expect(spec).toMatch(/^openapi: 3\.1\.\d+$/m);
  });
});
