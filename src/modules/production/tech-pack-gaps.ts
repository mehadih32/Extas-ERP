import type { Db } from "@/lib/db-types";

/*
 * What keeps a style's tech pack from approval: the red cells. A chart value
 * missing, a red line of the latest AI draft nobody has said OK to or
 * changed, or a logo without the owner's tick. What a tech pack does not have
 * yet (no chart, no draft, no logo) keeps nothing back.
 */

type Line = { signal?: unknown; decision?: unknown };

function redLines(output: unknown): number {
  if (!output || typeof output !== "object" || Array.isArray(output)) return 0;
  const lines = (output as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return 0;
  return (lines as Line[]).filter((l) => l?.signal === "red" && !l.decision).length;
}

export async function techPackGaps(db: Db, projectId: string): Promise<string[]> {
  const techPack = await db.techPack.findUnique({
    where: { projectId },
    select: {
      measurements: { orderBy: { sortOrder: "asc" }, select: { name: true, values: true } },
      aiDrafts: { orderBy: { createdAt: "desc" }, take: 1, select: { output: true } },
      logos: { orderBy: { createdAt: "asc" }, select: { name: true, tickedAt: true } },
    },
  });
  if (!techPack) return [];
  const gaps: string[] = [];
  const missing = techPack.measurements.flatMap((m) => {
    const values =
      m.values && typeof m.values === "object" && !Array.isArray(m.values) ? m.values : {};
    return Object.values(values).some((v) => typeof v !== "number") ? [m.name] : [];
  });
  if (missing.length > 0) {
    gaps.push(
      `Measurements missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`,
    );
  }
  const red = redLines(techPack.aiDrafts[0]?.output);
  if (red > 0) gaps.push(`${red} red line(s) in the AI draft need an OK or a change`);
  const unticked = techPack.logos.filter((l) => !l.tickedAt).map((l) => l.name);
  if (unticked.length > 0) gaps.push(`Logo without the owner's tick: ${unticked.join(", ")}`);
  return gaps;
}
