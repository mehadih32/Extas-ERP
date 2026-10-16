import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A PIN box on a screen shows the server's "set your PIN first" message too
 * (settings.service.ts names that field "pinNotSet"): without it, an owner
 * with no PIN yet presses the button and sees nothing at all. The shared PIN
 * window (pin-prompt.tsx) asks for a PIN first in a window of its own.
 */

const root = path.join(process.cwd(), "src/components");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("PIN boxes", () => {
  it("show the 'set your PIN first' message on every screen", () => {
    const missing: string[] = [];
    for (const file of files(root)) {
      if (file.endsWith(path.join("ai", "pin-prompt.tsx"))) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<PinField\b[^>]*?\/>/gs)) {
        if (!match[0].includes('"pinNotSet"')) {
          const line = text.slice(0, match.index).split("\n").length;
          missing.push(`${path.relative(process.cwd(), file)}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
