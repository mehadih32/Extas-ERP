import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Two parts of one release once gave their migrations the same time: the order between
// them then rests on their names. Every new migration has a time of its own (the two of
// 2026-12-03 are already on the servers under these names and stay as they are).
const ALREADY_SHIPPED = new Set(["20261203090000"]);
describe("migrations", () => {
  it("each has its own time", () => {
    const dir = path.join(process.cwd(), "prisma/migrations");
    const times = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.split("_")[0] ?? d.name);
    const twice = times.filter((t, i) => times.indexOf(t) !== i && !ALREADY_SHIPPED.has(t));
    expect(twice).toEqual([]);
  });
});
