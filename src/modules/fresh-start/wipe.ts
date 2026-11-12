import { Prisma } from "@prisma/client";

import {
  fileMentionColumns,
  foreignKeys,
  freshStartSteps,
  type FreshStartTicks,
} from "@/modules/fresh-start/plan";

/*
 * The wipe itself, inside the caller's transaction (all of it, or nothing):
 * the plan's SQL in order (plan.ts), every statement for this one company
 * only ($1), then the company's files that nothing kept uses any more. The
 * files' bytes on disk go after the transaction is saved (fresh-start.service.ts).
 */

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export type WipeResult = {
  /** Rows erased per table (tables with none left out). */
  erased: Record<string, number>;
  /** Stored files whose records were erased: their bytes go once the wipe is saved. */
  files: { storagePath: string }[];
};

/** SQL that erases the company's files no kept row links to or names; returns their paths. */
export function fileSql(ticks: FreshStartTicks): string {
  const linked = foreignKeys()
    .filter((k) => k.to === "FileAsset" && k.columns.length === 1)
    .map((k) => `NOT EXISTS (SELECT 1 FROM ${q(k.from)} r WHERE r.${q(k.columns[0]!)} = f."id")`);
  const named = fileMentionColumns(ticks).map((c) => {
    const text = c.json ? `t.${q(c.column)}::text` : `t.${q(c.column)}`;
    const scope = c.tenant ? `t."companyId" = $1 AND ` : "";
    return `NOT EXISTS (SELECT 1 FROM ${q(c.model)} t WHERE ${scope}(strpos(${text}, f."id") > 0 OR strpos(${text}, f."storagePath") > 0))`;
  });
  return `DELETE FROM "FileAsset" f WHERE f."companyId" = $1 AND ${[...linked, ...named].join(" AND ")} RETURNING f."storagePath"`;
}

export async function wipeCompany(
  tx: Prisma.TransactionClient,
  companyId: string,
  ticks: FreshStartTicks,
): Promise<WipeResult> {
  const erased: Record<string, number> = {};
  for (const step of freshStartSteps(ticks)) {
    const count = await tx.$executeRawUnsafe(step.sql, companyId);
    if (step.kind === "erase" && count > 0) erased[step.model] = count;
  }
  const files = await tx.$queryRawUnsafe<{ storagePath: string }[]>(fileSql(ticks), companyId);
  if (files.length > 0) erased.FileAsset = files.length;
  return { erased, files };
}
