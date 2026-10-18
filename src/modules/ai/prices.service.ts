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
import {
  costOf,
  dayText,
  listedModel,
  LONG_FIELDS,
  PRICE_FIELDS,
  PRICE_WORDS,
  type PriceFields,
  type PriceRule,
} from "./price-list";
import { modelLabel, modelRef, parseModel, providerOf } from "./providers";

/*
 * Model prices (AI Center > Models), US dollars per million tokens: the
 * built-in price list of Claude, OpenAI and Gemini models (price-list.ts, from
 * each provider's price page), with the owner's own price over it for any
 * model. A model with neither has no price: it is blocked everywhere (v6.4
 * A7), because its cost could not be counted. It is never called, it cannot be
 * given work, and the owner is told (once a day per model) when something
 * tries to use it. Its cost is never written as a known 0.
 *
 * The owner's price keeps where it came from (a link, or "Typed by <name> on
 * <day>"), and its own long-prompt prices; without them the list's long-prompt
 * prices still hold over the owner's normal ones (v6.4.1 C4), so a new normal
 * price never makes a long prompt on Haiku 5.5 look 5 times cheaper.
 */

export type Price = PriceRule & {
  /** "erp": the built-in price list; "owner": set on AI Center > Models. */
  from: "erp" | "owner";
  sourceUrl?: string;
  checkedOn?: string;
  setById?: string | null;
  setAt?: Date;
  /** Where the owner's price came from. */
  source?: string | null;
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
    const longInput = num(r.longInputPerM);
    const longOutput = num(r.longOutputPerM);
    book.set(r.model, {
      input,
      output,
      cacheRead: num(r.cacheReadPerM),
      cacheWrite: num(r.cacheWritePerM),
      batchInput: num(r.batchInputPerM),
      batchOutput: num(r.batchOutputPerM),
      ...(r.longAbove && longInput !== null && longOutput !== null
        ? {
            long: {
              above: r.longAbove,
              input: longInput,
              output: longOutput,
              cacheRead: num(r.longCacheReadPerM),
              cacheWrite: num(r.longCacheWritePerM),
              batchInput: num(r.longBatchInputPerM),
              batchOutput: num(r.longBatchOutputPerM),
            },
          }
        : {}),
      from: "owner",
      setById: r.updatedById,
      setAt: r.updatedAt,
      source: r.source,
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
 * The owner's price without long-prompt prices of its own keeps the list's.
 */
export function priceFor(book: PriceBook, model: string): Price | null {
  const ref = normalModel(model);
  const listed = listedModel(ref);
  const own = book.get(ref) ?? (listed ? book.get(listed.ref) : undefined);
  if (own) return own.long || !listed?.long ? own : { ...own, long: listed.long };
  return listed ? { ...listed, from: "erp" } : null;
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

/** The prompt length (tokens) the long prices start above, or empty. */
const tokens = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/[,\s]/g, ""))
  .refine(
    (v) => v === "" || (/^\d{1,9}$/.test(v) && Number(v) > 0),
    "Tokens, a whole number like 200000",
  )
  .transform((v) => (v === "" ? null : Number(v)));

type PriceText = Record<keyof PriceFields, string | null>;

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
    longAbove: tokens.nullish(),
    longInput: mainPrice.nullish(),
    longOutput: mainPrice.nullish(),
    longCacheRead: otherPrice.nullish(),
    longCacheWrite: otherPrice.nullish(),
    longBatchInput: otherPrice.nullish(),
    longBatchOutput: otherPrice.nullish(),
    /** Where the price came from: a link or a few words; empty: "Typed by <name> on <day>". */
    source: z
      .string()
      .trim()
      .max(300, "Up to 300 characters")
      .nullish()
      .transform((v) => v || null),
  })
  .superRefine((p, issue) => {
    if ((p.input == null) !== (p.output == null)) {
      issue.addIssue({
        code: "custom",
        message: "Give both prices (input and output), or neither",
        path: ["output"],
      });
    }
    if ((p.longInput == null) !== (p.longOutput == null)) {
      issue.addIssue({
        code: "custom",
        message: "Give both long-prompt prices (input and output), or neither",
        path: [p.longInput == null ? "longInput" : "longOutput"],
      });
    }
    // The line long prices start above: given, or the price page's for the model.
    if (p.longInput != null && p.longAbove == null && !listedModel(normalModel(p.model))?.long) {
      issue.addIssue({
        code: "custom",
        message: "Give the prompt length the long prices start above, like 200000",
        path: ["longAbove"],
      });
    }
  })
  .transform((p) => {
    // Long prices not sent at all: undefined (the saved ones stay); sent empty:
    // null (back to the price page's); else the owner's own.
    const sent =
      p.longAbove !== undefined || Object.values(LONG_FIELDS).some((f) => p[f] !== undefined);
    const long =
      !sent || p.longInput == null || p.longOutput == null
        ? sent
          ? null
          : undefined
        : {
            above: p.longAbove ?? listedModel(normalModel(p.model))!.long!.above,
            ...(Object.fromEntries(
              PRICE_FIELDS.map((f) => [f, p[LONG_FIELDS[f]] ?? null]),
            ) as PriceText),
          };
    return {
      model: p.model,
      input: p.input ?? null,
      output: p.output ?? null,
      cacheRead: p.cacheRead ?? null,
      cacheWrite: p.cacheWrite ?? null,
      batchInput: p.batchInput ?? null,
      batchOutput: p.batchOutput ?? null,
      ...(long === undefined ? {} : { long }),
      source: p.source,
    };
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
  // Where it came from: the owner's words, else who typed it and when.
  const source =
    p.source ??
    `Typed by ${ctx.user.name} on ${dayText(localDay(new Date(), ctx.company.timezone))}`;
  // Long-prompt prices not sent stay as saved; sent empty, the list's hold again.
  const long =
    p.long === undefined
      ? {}
      : {
          longAbove: p.long?.above ?? null,
          longInputPerM: decimal(p.long?.input ?? null),
          longOutputPerM: decimal(p.long?.output ?? null),
          longCacheReadPerM: decimal(p.long?.cacheRead ?? null),
          longCacheWritePerM: decimal(p.long?.cacheWrite ?? null),
          longBatchInputPerM: decimal(p.long?.batchInput ?? null),
          longBatchOutputPerM: decimal(p.long?.batchOutput ?? null),
        };
  const data = {
    provider,
    inputPerM: decimal(p.input),
    outputPerM: decimal(p.output),
    cacheReadPerM: decimal(p.cacheRead),
    cacheWritePerM: decimal(p.cacheWrite),
    batchInputPerM: decimal(p.batchInput),
    batchOutputPerM: decimal(p.batchOutput),
    ...long,
    source,
    blockedNoticeOn: null,
    updatedById: ctx.user.id,
  };
  await prisma.aiModelPrice.upsert({
    where: { companyId_model: { companyId: ctx.company.id, model } },
    create: { ...data, companyId: ctx.company.id, model },
    update: data,
  });
  const given = (t: Record<keyof PriceFields, string | null>) =>
    PRICE_FIELDS.filter((f) => t[f] !== null)
      .map((f) => `$${t[f]} ${PRICE_WORDS[f]}`)
      .join(", ");
  const longText =
    p.long === undefined
      ? ""
      : p.long === null
        ? listedModel(model)?.long
          ? "; long prompts back to the built-in price list"
          : ""
        : `; prompts over ${p.long.above.toLocaleString("en-US")} tokens: ${given(p.long)}`;
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `${label}: price set to ${given(p)} per million tokens${longText} (from: ${source})`,
  });
}
