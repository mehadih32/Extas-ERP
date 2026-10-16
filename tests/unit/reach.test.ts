import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { NOT_REACHED, reach, reachSearch } from "@/lib/reach";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

// Found by the Full check: a search box that opened while the connection was
// gone (or the request was stopped) took the whole screen down with "This
// screen could not open" (Materials > New order, Accounts > Pay a supplier,
// Production > Save to Tech Pack).
describe("a request that gets no answer", () => {
  it("passes the action's own answer through", async () => {
    await expect(reach(async () => ({ ok: true as const, data: 3 }))).resolves.toEqual({
      ok: true,
      data: 3,
    });
    await expect(reachSearch(async () => [{ id: "a" }])).resolves.toEqual([{ id: "a" }]);
  });

  it("comes back as a calm message instead of an error screen", async () => {
    const lost = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(reach(lost)).resolves.toEqual({
      ok: false,
      error: { code: "INTERNAL", message: NOT_REACHED },
    });
    await expect(reachSearch(lost)).resolves.toBe(NOT_REACHED);
  });

  it("still lets Next.js redirects go on", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/" });
    await expect(
      reach(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });

  it("is used by every search box and the screens that ask on their own", () => {
    expect(source("src/components/sales/pickers.tsx")).toContain(
      "await reachSearch(() => searchRef.current(text))",
    );
    const save = source("src/components/production/tech-pack/save-form.tsx");
    expect(save).toContain("await reach(() => pickSaveTargetsAction(search))");
    expect(save).toContain("await reach(() => saveToTechPackAction(chosen, form))");
    for (const file of [
      "src/components/ai/full-check-screen.tsx",
      "src/components/ai/skill-screen.tsx",
    ]) {
      expect(source(file)).toContain("const result = await reach(work);");
    }
  });

  it("leaves no screen loading a Server Action on its own without a way to fail", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(path.join(process.cwd(), "src/components"));
    const bare: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/void \w+Action\(/.test(line)) return;
        if (lines.slice(i, i + 30).some((l) => l.includes(".catch("))) return;
        bare.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
      });
    }
    expect(bare).toEqual([]);
  });
});
