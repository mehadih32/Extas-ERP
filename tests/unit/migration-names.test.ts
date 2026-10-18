import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Two parts of one release once gave their migrations the same time: the order between
// them then rests on their names. Every migration has a time of its own.
describe("migrations", () => {
  it("each has its own time", () => {
    const dir = path.join(process.cwd(), "prisma/migrations");
    const times = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.split("_")[0]);
    const twice = times.filter((t, i) => times.indexOf(t) !== i);
    expect(twice).toEqual([]);
  });
});
