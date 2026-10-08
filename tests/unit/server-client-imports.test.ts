import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * A page or layout (a Server Component) that imports from a "use client" file
 * gets only its components: any other export (a constant, a helper) arrives as
 * a client reference rather than its value. Such values belong in a plain module
 * both sides import (like components/products/stock-history-view.ts).
 */

const root = path.resolve(__dirname, "../..");
const isClient = (source: string) => /^\s*["']use client["']/.test(source);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolveModule(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  return [".tsx", ".ts", "/index.tsx", "/index.ts"]
    .map((ext) => base + ext)
    .find((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
}

/** Names a Server Component may take from a "use client" file: its components. */
const isComponentName = (name: string) => /^[A-Z][a-z0-9][A-Za-z0-9]*$/.test(name);

describe("server pages and client files", () => {
  it('take only components from "use client" files', () => {
    const misuse: string[] = [];
    const serverFiles = files(path.join(root, "src/app")).filter(
      (file) => !isClient(readFileSync(file, "utf8")),
    );
    for (const file of serverFiles) {
      const source = readFileSync(file, "utf8");
      const imports = source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g);
      for (const [, typeOnly, names, specifier] of imports) {
        if (typeOnly || !(specifier!.startsWith("@/") || specifier!.startsWith("."))) continue;
        const target = resolveModule(file, specifier!);
        if (!target || !isClient(readFileSync(target, "utf8"))) continue;
        for (const raw of names!.split(",")) {
          const entry = raw.trim();
          if (!entry || entry.startsWith("type ")) continue;
          const name = entry.split(/\s+as\s+/)[0]!.trim();
          if (!isComponentName(name)) {
            misuse.push(`${path.relative(root, file)} imports ${name} from ${specifier}`);
          }
        }
      }
    }
    expect(serverFiles.length).toBeGreaterThan(10);
    expect(misuse).toEqual([]);
  });
});
