import { Prisma } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { activeMembers, membersWith } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

import type { TokenUse } from "./models";
import { costOf, listedModel, PRICE_FIELDS, PRICE_WORDS, type PriceRule } from "./price-list";
import { modelLabel, modelRef, parseModel, providerOf } from "./providers";

/*
 * Model prices (AI Center > Models), US dollars per million tokens: the
 * built-in price list of Claude, OpenAI and Gemini models (price-list.ts, from
 * each provider's price page), with the owner's own price over it for any
 * model. A model with neither has no price: it is blocked everywhere (v6.4
 * A7), because its cost could not be counted. It is never called, it cannot be
 * given work, and the owner is told (once a day per model) when something
 * tries to use it. Its cost is never written as a known 0.
 */

export type Price = PriceRule & {
  /** "erp": the built-in price list; "owner": set on AI Center > Models. */
  from: "erp" | "owner";
  sourceUrl?: string;
  checkedOn?: string;
  setById?: string | null;
  setAt?: Date;
};

/** The owner's prices in the company, by model. */
export type PriceBook = ReadonlyMap<string, Price>;

/** A kept price; 0 (which v6.3 took) is none: work is never counted as free. */
const num = (v: Prisma.Decimal | null) => (v === null || !v.gt(0) ? null : v.toNumber());

export async function priceBook(companyId: string, db: Db = prisma): Promise<PriceBook> {
  const rows = await db.aiModelPrice.findMany({ where: { companyId } });
  const book = new Map<string, Price>();
  for (const r of rows) {
    // A row without prices only remembers the day a notice went out; one with an
    // input or output price of 0 has no price either (blocked, never cost 0).
    const input = num(r.inputPerM);
    const output = num(r.outputPerM);
    if (input === null || output === null) continue;
    book.set(r.model, {
      input,
      output,
      cacheRead: num(r.cacheReadPerM),
      cacheWrite: num(r.cacheWritePerM),
      batchInput: num(r.batchInputPerM),
      batchOutput: num(r.batchOutputPerM),
      from: "owner",
      setById: r.updatedById,
      setAt: r.updatedAt,
    });
  }
  return book;
}

/** "anthropic:<name>" and the bare "<name>" are one model. */
export const normalModel = (model: string) => {
  const ref = parseModel(model);
  return ref ? modelRef(ref.provider, ref.id) : model;
};

/**
 * A model's price: the owner's, else the built-in list's (a Claude snapshot
 * takes its model's, the owner's first), else null: the model is blocked.
 */
export function priceFor(book: PriceBook, model: string): Price | null {
  const ref = normalModel(model);
  const own = book.get(ref);
  if (own) return own;
  const listed = listedModel(ref);
  if (!listed) return null;
  return book.get(listed.ref) ?? { ...listed, from: "erp" };
}

/**
 * What a call cost in US dollars, and whether it is known. Work on a model
 * with no price is never counted as 0: it is "price unknown" (a call that
 * never ran used nothing, and is known to have cost nothing).
 */
export function costIn(
  book: PriceBook,
  model: string,
  use: TokenUse,
  at: Date = new Date(),
): { usd: number; known: boolean } {
  const price = priceFor(book, model);
  if (!price) {
    const used = use.input + use.output + (use.cacheRead ?? 0) + (use.cacheWrite ?? 0);
    return { usd: 0, known: used === 0 };
  }
  return { usd: costOf(price, use, providerOf(model), at), known: true };
}

/** The line people read when a model has no price. */
export const blockedText = (label: string) =>
  `${label} has no price yet, so it is blocked. Add its price in AI Center > Models.`;

/** Whether a model has a price in the company (else it is blocked). */
export async function hasPrice(companyId: string, model: string, db: Db = prisma) {
  return priceFor(await priceBook(companyId, db), model) !== null;
}

/**
 * Tells the people who manage the AI (in the inbox) that something tried to
 * use a model with no price: once a day per model, even when two tries come
 * at once. A notice that cannot be sent never stops the refusal.
 */
export async function warnBlocked(
  companyId: string,
  model: string,
  about: { label: string; work: string },
  now: Date = new Date(),
  db: Db = prisma,
): Promise<boolean> {
  try {
    const ref = normalModel(model);
    const company = await db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    });
    const day = localDay(now, company.timezone);
    // Claim the day for this model (a row without prices remembers it): the
    // first try today makes or moves the row, every other try finds it taken.
    const made = await db.aiModelPrice.createMany({
      data: [{ companyId, model: ref, provider: providerOf(ref), blockedNoticeOn: day }],
      skipDuplicates: true,
    });
    if (made.count === 0) {
      const taken = await db.aiModelPrice.updateMany({
        where: {
          companyId,
          model: ref,
          inputPerM: null,
          OR: [{ blockedNoticeOn: null }, { blockedNoticeOn: { not: day } }],
        },
        data: { blockedNoticeOn: day },
      });
      if (taken.count === 0) return false;
    }
    const owners = membersWith(await activeMembers(companyId, db), ["ai.manage"]);
    await sendInApp(
      db,
      companyId,
      owners.map((userId) => ({ userId })),
      {
        subject: `${about.label} is blocked: it has no price`,
        body: `${about.work} tried to use ${about.label}, but it has no price yet, so it is blocked and nothing was sent to it. Add its price in AI Center > Models, or give the work another model there.`,
        entityType: "AiModelPrice",
        entityId: ref,
      },
      now,
    );
    return true;
  } catch (error) {
    console.error(
      "[ai] the notice about a blocked model was not sent",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

const DOLLARS = /^\d{1,6}(\.\d{1,4})?$/;

/**
 * A price in dollars per million tokens, or empty. Never 0: a price of 0
 * would count the model's work as free (v6.4 A7), so a price is more than 0.
 */
const perMillion = (zero: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(/^\$/, ""))
    .refine((v) => v === "" || DOLLARS.test(v), "Dollars per million tokens, like 2.50")
    .refine((v) => v === "" || !DOLLARS.test(v) || Number(v) > 0, zero)
    .transform((v) => (v === "" ? null : v));

/** Input and output: empty only to clear the price (both), else more than 0. */
const mainPrice = perMillion("More than 0 dollars, like 2.50");
/** Cache and batch prices: empty (charged as plain work) or more than 0. */
const otherPrice = perMillion("Empty, or more than 0 dollars, like 2.50");

export const priceSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(140)
      .refine((m) => parseModel(m) !== null, "Pick a model"),
    input: mainPrice.nullish(),
    output: mainPrice.nullish(),
    cacheRead: otherPrice.nullish(),
    cacheWrite: otherPrice.nullish(),
    batchInput: otherPrice.nullish(),
    batchOutput: otherPrice.nullish(),
  })
  .transform((p) => ({
    model: p.model,
    input: p.input ?? null,
    output: p.output ?? null,
    cacheRead: p.cacheRead ?? null,
    cacheWrite: p.cacheWrite ?? null,
    batchInput: p.batchInput ?? null,
    batchOutput: p.batchOutput ?? null,
  }))
  .refine((p) => (p.input === null) === (p.output === null), {
    message: "Give both prices (input and output), or neither",
    path: ["output"],
  });

const decimal = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));

/** The PIN sent with a price (checked, never kept). */
const pinSchema = z.object({ pin: z.string().max(20).optional() });

/**
 * Sets a model's price (any price on the provider's page); empty input and
 * output put the built-in price back (or, for a model on no list, no price:
 * blocked). Only the owner (ai.manage), with the PIN like every price action
 * (CLAUDE.md section 2); every change is in the audit log.
 */
export async function setModelPrice(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  if (!ctx.can("ai.manage")) throw new AppError("FORBIDDEN", "Only the owner sets the AI prices.");
  const p = priceSchema.parse(input);
  const { pin } = pinSchema.parse(input);
  // settings.service reads the prices, so it is loaded only when the PIN is checked.
  const { requirePin } = await import("./settings.service");
  await requirePin(ctx, pin, p.input === null ? "clear a model's price" : "set a model's price");
  const model = normalModel(p.model);
  const provider = parseModel(model)!.provider;
  const label = modelLabel(model);
  if (p.input === null) {
    await prisma.aiModelPrice.deleteMany({ where: { companyId: ctx.company.id, model } });
    await auditInCompany(ctx, meta, {
      action: "UPDATE",
      entityType: "AiSettings",
      entityId: ctx.company.id,
      summary: `${label}: price set back to ${listedModel(model) ? "the built-in price list" : "none (blocked until it has one)"}`,
    });
    return;
  }
  const data = {
    provider,
    inputPerM: decimal(p.input),
    outputPerM: decimal(p.output),
    cacheReadPerM: decimal(p.cacheRead),
    cacheWritePerM: decimal(p.cacheWrite),
    batchInputPerM: decimal(p.batchInput),
    batchOutputPerM: decimal(p.batchOutput),
    blockedNoticeOn: null,
    updatedById: ctx.user.id,
  };
  await prisma.aiModelPrice.upsert({
    where: { companyId_model: { companyId: ctx.company.id, model } },
    create: { ...data, companyId: ctx.company.id, model },
    update: data,
  });
  const given = PRICE_FIELDS.filter((f) => p[f] !== null)
    .map((f) => `$${p[f]} ${PRICE_WORDS[f]}`)
    .join(", ");
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `${label}: price set to ${given} per million tokens`,
  });
}
