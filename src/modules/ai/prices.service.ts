import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import { AI_MODELS, CACHE_WRITE_FACTOR, costUsd, modelInfo, type TokenUse } from "./models";
import { modelLabel, parseModel } from "./providers";

/*
 * Model prices (AI Center > Models > Prices), US dollars per million tokens.
 * The ERP's own Claude models have the Claude price list's prices until the
 * owner sets others (providers change prices); any other model has no price
 * until the owner sets one, and its calls then say "price unknown" (cost 0,
 * marked) rather than a guess.
 */

export type Price = {
  input: number;
  output: number;
  /** Reading from the provider's cache; null: charged as plain reading. */
  cacheRead: number | null;
  from: "erp" | "owner";
};

/** The company's prices: the owner's, over the ERP's own for its Claude models. */
export type PriceBook = ReadonlyMap<string, Price>;

export async function priceBook(companyId: string, db: Db = prisma): Promise<PriceBook> {
  const rows = await db.aiModelPrice.findMany({ where: { companyId } });
  const book = new Map<string, Price>();
  for (const m of AI_MODELS) {
    book.set(m.id, { input: m.input, output: m.output, cacheRead: m.cacheRead, from: "erp" });
  }
  for (const r of rows) {
    if (r.inputPerM === null || r.outputPerM === null) continue;
    book.set(r.model, {
      input: r.inputPerM.toNumber(),
      output: r.outputPerM.toNumber(),
      cacheRead: r.cacheReadPerM?.toNumber() ?? null,
      from: "owner",
    });
  }
  return book;
}

/** What a call cost in US dollars, and whether the model's price is known. */
export function costIn(
  book: PriceBook,
  model: string,
  use: TokenUse,
): { usd: number; known: boolean } {
  const price = book.get(model);
  if (!price) {
    const used = use.input + use.output + (use.cacheRead ?? 0) + (use.cacheWrite ?? 0);
    return { usd: 0, known: used === 0 };
  }
  // The ERP's own price list keeps its long-prompt rule.
  if (price.from === "erp" && modelInfo(model)) return { usd: costUsd(model, use), known: true };
  const dollars =
    use.input * price.input +
    use.output * price.output +
    (use.cacheRead ?? 0) * (price.cacheRead ?? price.input) +
    (use.cacheWrite ?? 0) * price.input * CACHE_WRITE_FACTOR;
  return { usd: dollars / 1_000_000, known: true };
}

const perMillion = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/^\$/, ""))
  .refine(
    (v) => v === "" || (/^\d{1,6}(\.\d{1,4})?$/.test(v) && Number(v) >= 0),
    "Dollars per million tokens, like 2.50",
  )
  .transform((v) => (v === "" ? null : v));

export const priceSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(140)
      .refine((m) => parseModel(m) !== null, "Pick a model"),
    input: perMillion.nullish(),
    output: perMillion.nullish(),
    cacheRead: perMillion.nullish(),
  })
  .refine((p) => (p.input == null) === (p.output == null), {
    message: "Give both prices (reading and writing), or neither",
    path: ["output"],
  });

/** Sets a model's price; empty puts the ERP's own price back (or "price unknown"). */
export async function setModelPrice(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  if (!ctx.can("ai.manage")) throw new AppError("FORBIDDEN", "Only the owner sets the AI prices.");
  const p = priceSchema.parse(input);
  const provider = parseModel(p.model)!.provider;
  const where = { companyId_model: { companyId: ctx.company.id, model: p.model } };
  if (p.input == null) {
    await prisma.aiModelPrice.deleteMany({ where: { companyId: ctx.company.id, model: p.model } });
  } else {
    const data = {
      provider,
      inputPerM: new Prisma.Decimal(p.input),
      outputPerM: new Prisma.Decimal(p.output!),
      cacheReadPerM: p.cacheRead == null ? null : new Prisma.Decimal(p.cacheRead),
      updatedById: ctx.user.id,
    };
    await prisma.aiModelPrice.upsert({
      where,
      create: { ...data, companyId: ctx.company.id, model: p.model },
      update: data,
    });
  }
  const label = modelLabel(p.model);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary:
      p.input == null
        ? `${label}: price set back to ${modelInfo(p.model) ? "the ERP's price list" : "unknown"}`
        : `${label}: price set to $${p.input} reading, $${p.output} writing per million tokens`,
  });
}
