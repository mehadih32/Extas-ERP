import type { HouseRule, HouseRuleScope } from "@prisma/client";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Teach: the owner tells Mehedi 2.0 a rule in plain words ("for this buyer the
 * collar is always 3 1/4 inch"). It becomes a House Rule proposal, scoped to
 * everything, a buyer, a brand or an item, and counts only once the owner
 * approves it; old rules on the same thing are shown beside it. Approved rules
 * win over the books in every call (persona.ts). Only the owner (ai.manage)
 * teaches, approves and retires rules; the AI can only propose.
 */

export const SCOPE_LABELS: Record<HouseRuleScope, string> = {
  ALL: "Everything",
  BUYER: "A buyer",
  BRAND: "A brand",
  ITEM: "An item",
};

export const houseRuleSchema = z
  .object({
    text: z.string().trim().min(3, "Write the rule").max(500, "Use at most 500 characters"),
    scope: z.enum(["ALL", "BUYER", "BRAND", "ITEM"]).default("ALL"),
    scopeValue: z
      .string()
      .trim()
      .max(120)
      .transform((v) => v || null)
      .nullish(),
  })
  .refine((r) => r.scope === "ALL" || Boolean(r.scopeValue), {
    message: "Name the buyer, brand or item",
    path: ["scopeValue"],
  });

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner teaches and approves House Rules.");
  }
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "all",
  "this",
  "that",
  "with",
  "always",
  "never",
  "এই",
  "সব",
  "সবসময়",
  "আর",
  "হবে",
  "না",
  "কখনো",
]);

const wordsOf = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[\s,.;:!?()"'“”‘’।|/\\-]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );

/** Approved rules on the same thing (the same scope and at least two words in common). */
export function sameThing(
  rule: Pick<HouseRule, "text" | "scope" | "scopeValue">,
  others: ReadonlyArray<Pick<HouseRule, "id" | "text" | "scope" | "scopeValue">>,
) {
  const mine = wordsOf(rule.text);
  return others.filter((o) => {
    const scoped =
      o.scope === "ALL" ||
      rule.scope === "ALL" ||
      (o.scope === rule.scope &&
        (o.scopeValue ?? "").toLowerCase() === (rule.scopeValue ?? "").toLowerCase());
    if (!scoped) return false;
    let common = 0;
    for (const w of wordsOf(o.text)) if (mine.has(w)) common += 1;
    return common >= 2;
  });
}

/** A House Rule proposal: the owner's words, or the AI's wording of them (said keeps the words). */
export async function proposeHouseRule(
  ctx: CompanyContext,
  input: unknown,
  meta?: RequestMeta,
  from: { said?: string; byAi?: boolean; source?: string } = {},
) {
  assertManage(ctx);
  const rule = houseRuleSchema.parse(input);
  const row = await prisma.houseRule.create({
    data: {
      companyId: ctx.company.id,
      text: rule.text,
      scope: rule.scope,
      scopeValue: rule.scope === "ALL" ? null : rule.scopeValue,
      said: from.said?.slice(0, 1000) ?? null,
      byAi: from.byAi ?? false,
      source: from.source ?? "Teach",
      proposedById: ctx.user.id,
    },
  });
  // Worded by the AI: the log row is marked AI (the owner's own words stay theirs).
  await auditInCompany({ ...ctx, byAi: from.byAi ?? false }, meta, {
    action: "CREATE",
    entityType: "HouseRule",
    entityId: row.id,
    summary: `Proposed a House Rule: ${rule.text}`,
  });
  return row;
}

export const decideSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/** Approves or rejects a proposal: an approved rule counts from the next answer on. */
export async function decideHouseRule(
  ctx: CompanyContext,
  ruleId: string,
  input: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const { approve, note } = decideSchema.parse(input);
  const rule = await ctx.db.houseRule.findFirst({ where: { id: ruleId } });
  if (!rule) throw new AppError("NOT_FOUND", "This rule is not there any more.");
  const claimed = await prisma.houseRule.updateMany({
    where: { id: ruleId, companyId: ctx.company.id, status: "PROPOSED" },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      decidedById: ctx.user.id,
      decidedAt: new Date(),
      note: note ?? null,
    },
  });
  if (claimed.count === 0) throw new AppError("CONFLICT", "This rule was decided already.");
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "HouseRule",
    entityId: ruleId,
    summary: `${approve ? "Approved" : "Rejected"} the House Rule: ${rule.text}`,
  });
}

/** Stops an approved rule (kept in the list as retired). */
export async function retireHouseRule(ctx: CompanyContext, ruleId: string, meta?: RequestMeta) {
  assertManage(ctx);
  const rule = await ctx.db.houseRule.findFirst({ where: { id: ruleId } });
  if (!rule) throw new AppError("NOT_FOUND", "This rule is not there any more.");
  const claimed = await prisma.houseRule.updateMany({
    where: { id: ruleId, companyId: ctx.company.id, status: "APPROVED" },
    data: { status: "RETIRED", decidedById: ctx.user.id, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new AppError("CONFLICT", "Only an approved rule can be retired.");
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "HouseRule",
    entityId: ruleId,
    summary: `Retired the House Rule: ${rule.text}`,
  });
}

/** The rules as Teach shows them: proposals (with rules on the same thing), approved, past. */
export async function listHouseRules(ctx: CompanyContext) {
  const rows = await ctx.db.houseRule.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { decidedBy: { select: { name: true } } },
  });
  const approved = rows.filter((r) => r.status === "APPROVED");
  const shown = (r: (typeof rows)[number]) => ({
    id: r.id,
    text: r.text,
    said: r.said,
    scope: r.scope,
    scopeValue: r.scopeValue,
    status: r.status,
    source: r.source,
    byAi: r.byAi,
    decidedBy: r.decidedBy?.name ?? null,
    decidedAt: r.decidedAt,
    note: r.note,
    createdAt: r.createdAt,
  });
  return {
    proposed: rows
      .filter((r) => r.status === "PROPOSED")
      .map((r) => ({
        ...shown(r),
        sameThing: sameThing(r, approved).map((o) => ({ id: o.id, text: o.text })),
      })),
    approved: approved.map(shown),
    past: rows.filter((r) => r.status === "REJECTED" || r.status === "RETIRED").map(shown),
    can: { manage: ctx.can("ai.manage") },
  };
}

export type HouseRules = Awaited<ReturnType<typeof listHouseRules>>;
