import type { AiSettings, Prisma } from "@prisma/client";
import { z } from "zod";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

import { agentKeyOf, aiAgents } from "./agents";
import { AI_TASKS, type AiTaskKey, modelFor, modelInfo, TASK_KEYS } from "./models";
import { modelTestRuns, MODEL_TEST_TEXT, standingOf } from "./model-test-standing";
import { listedModel, PRICE_FIELDS, PRICE_LISTS, priceNotes, type PriceFields } from "./price-list";
import {
  blockedText,
  normalModel,
  type Price,
  type PriceBook,
  priceBook,
  priceFor,
} from "./prices.service";
import { listModels, ProviderError } from "./provider-calls";
import {
  BUILT_IN_MODELS,
  isBuiltIn,
  modelLabel,
  modelRef,
  parseModel,
  PROVIDERS,
  PROVIDER_IDS,
  type ProviderId,
  providerInfo,
  type ReadModel,
} from "./providers";

/*
 * A company's AI switch, keys, models and PIN (AI Center > Control, Models and
 * Settings). AI starts off: with the switch off or paused nothing calls the
 * AI, every feature falls back to its own non-AI way, and the AI costs nothing.
 * The Claude, OpenAI and Gemini keys are kept sealed (lib/crypto.ts) and never
 * shown again; the server's AI_API_KEY stands in for Claude while the company
 * has no Claude key of its own. Any model of any provider can be picked for
 * any task and any agent (from the models read from the provider). Only
 * people with ai.manage (the owner by default) change any of it; the AI itself
 * never can.
 */

/** The company's settings row, or the defaults (off) before anything was set. */
export async function aiSettingsOf(companyId: string, db: Db = prisma): Promise<AiSettings> {
  const row = await db.aiSettings.findUnique({ where: { companyId } });
  return (
    row ?? {
      id: "",
      companyId,
      enabled: false,
      changedAt: null,
      changedById: null,
      pausedAt: null,
      apiKeySealed: null,
      apiKeyHint: null,
      apiKeySetAt: null,
      openaiKeySealed: null,
      openaiKeyHint: null,
      openaiKeySetAt: null,
      geminiKeySealed: null,
      geminiKeyHint: null,
      geminiKeySetAt: null,
      keyTests: null,
      providerModels: null,
      agentModels: null,
      agentsOff: [],
      models: null,
      allowFable: false,
      pinHash: null,
      pinSetAt: null,
      assistantName: "Mehedi 2.0",
      aiUserId: null,
      replyRemindHours: 24,
      morningBrief: true,
      eveningReport: true,
      briefSentOn: null,
      reportSentOn: null,
      healthWeekly: false,
      healthRanOn: null,
      githubRepo: null,
      githubTokenSealed: null,
      githubTokenHint: null,
      githubTest: null,
      updatedAt: new Date(0),
    }
  );
}

/** The key the company's AI uses: its own, else the server's (AI_API_KEY), else none. */
export function apiKeyOf(settings: Pick<AiSettings, "apiKeySealed">): string | null {
  if (settings.apiKeySealed) {
    try {
      return decryptSecret(settings.apiKeySealed);
    } catch (error) {
      console.error("[ai] the stored Claude key could not be unlocked", error);
      return null;
    }
  }
  return process.env.AI_API_KEY?.trim() || null;
}

type KeyFields = Pick<AiSettings, "apiKeySealed" | "openaiKeySealed" | "geminiKeySealed">;

function unseal(sealed: string | null, provider: ProviderId): string | null {
  if (!sealed) return null;
  try {
    return decryptSecret(sealed);
  } catch (error) {
    console.error(
      `[ai] the stored ${providerInfo(provider).label} key could not be unlocked`,
      error,
    );
    return null;
  }
}

/** A provider's key in this company (Claude's: its own, else the server's AI_API_KEY), or null. */
export function keyFor(settings: KeyFields, provider: ProviderId): string | null {
  if (provider === "openai") return unseal(settings.openaiKeySealed, provider);
  if (provider === "google") return unseal(settings.geminiKeySealed, provider);
  return apiKeyOf(settings);
}

export type AiOff = "switched-off" | "paused" | "no-key";

/** Why the AI is not working now, or null when it is (a key of any provider will do). */
export function offReason(settings: AiSettings): AiOff | null {
  if (!settings.enabled) return "switched-off";
  if (settings.pausedAt) return "paused";
  return PROVIDER_IDS.some((p) => keyFor(settings, p)) ? null : "no-key";
}

export const OFF_TEXT: Record<AiOff, string> = {
  "switched-off": "AI is switched off. The owner turns it on in AI Center.",
  paused: "AI is paused. The owner resumes it in AI Center.",
  "no-key":
    "AI has no key yet. The owner adds a Claude, OpenAI or Gemini key in AI Center > Settings.",
};

function jsonMap(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** The models each provider offered the key when last read. */
export function readModelsOf(settings: Pick<AiSettings, "providerModels">) {
  const raw = jsonMap(settings.providerModels);
  const out: Partial<Record<ProviderId, { readAt: string; models: ReadModel[] }>> = {};
  for (const p of PROVIDER_IDS) {
    const entry = jsonMap(raw[p]);
    if (!Array.isArray(entry.models)) continue;
    out[p] = {
      readAt: String(entry.readAt ?? ""),
      models: (entry.models as unknown[]).flatMap((m) => {
        const x = jsonMap(m);
        return typeof x.id === "string" ? [{ id: x.id, label: String(x.label ?? x.id) }] : [];
      }),
    };
  }
  return out;
}

export type KeyTest = { ok: boolean; at: string; note: string };

function keyTestsOf(settings: Pick<AiSettings, "keyTests">) {
  const raw = jsonMap(settings.keyTests);
  const out: Partial<Record<ProviderId, KeyTest>> = {};
  for (const p of PROVIDER_IDS) {
    const t = jsonMap(raw[p]);
    if (typeof t.ok === "boolean")
      out[p] = { ok: t.ok, at: String(t.at ?? ""), note: String(t.note ?? "") };
  }
  return out;
}

/** The models chosen per agent (the owner's picks only). */
export function agentModelsOf(settings: Pick<AiSettings, "agentModels">): Record<string, string> {
  return Object.fromEntries(
    Object.entries(jsonMap(settings.agentModels)).filter(
      (e): e is [string, string] => typeof e[1] === "string" && parseModel(e[1]) !== null,
    ),
  );
}

/** The models chosen per task (the owner's picks only). */
export function chosenModels(settings: Pick<AiSettings, "models">): Record<string, string> {
  const raw = settings.models;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
}

/** The model a task runs on in this company. */
export function companyModelFor(settings: AiSettings, task: AiTaskKey) {
  return modelFor(task, chosenModels(settings), settings.allowFable);
}

/** The model an agent's work on a task runs on: the agent's own model, else the task's. */
export function modelForWork(settings: AiSettings, task: AiTaskKey, agent?: string | null) {
  const key = agentKeyOf(agent, settings.assistantName);
  const own = key ? agentModelsOf(settings)[key] : undefined;
  if (own && !(own === "claude-fable-5-1" && !settings.allowFable)) return own;
  return companyModelFor(settings, task);
}

function assertManage(ctx: CompanyContext) {
  if (!ctx.can("ai.manage")) {
    throw new AppError("FORBIDDEN", "Only the owner changes what the AI may do.");
  }
}

async function saveSettings(
  ctx: CompanyContext,
  data: Prisma.AiSettingsUncheckedUpdateInput,
  db: Db = prisma,
) {
  return db.aiSettings.upsert({
    where: { companyId: ctx.company.id },
    create: { ...(data as Prisma.AiSettingsUncheckedCreateInput), companyId: ctx.company.id },
    update: data,
  });
}

/** What the AI Center shows about the switch, the key and the PIN (never the key itself). */
export async function getAiStatus(ctx: CompanyContext) {
  const [settings, book] = await Promise.all([
    aiSettingsOf(ctx.company.id),
    priceBook(ctx.company.id),
  ]);
  const changedBy = settings.changedById
    ? await prisma.user.findUnique({
        where: { id: settings.changedById },
        select: { name: true },
      })
    : null;
  const off = offReason(settings);
  return {
    enabled: settings.enabled,
    paused: settings.pausedAt !== null,
    pausedAt: settings.pausedAt,
    working: off === null,
    offText: off ? OFF_TEXT[off] : null,
    changedAt: settings.changedAt,
    changedBy: changedBy?.name ?? null,
    key: settings.apiKeySealed
      ? { own: true as const, hint: settings.apiKeyHint, setAt: settings.apiKeySetAt }
      : process.env.AI_API_KEY?.trim()
        ? { own: false as const, hint: null, setAt: null }
        : null,
    /** Each provider's key (never the key itself) and its last Test. */
    providers: PROVIDERS.map((p) => {
      const tests = keyTestsOf(settings);
      const read = readModelsOf(settings)[p.id];
      const own =
        p.id === "openai"
          ? settings.openaiKeySealed && {
              hint: settings.openaiKeyHint,
              setAt: settings.openaiKeySetAt,
            }
          : p.id === "google"
            ? settings.geminiKeySealed && {
                hint: settings.geminiKeyHint,
                setAt: settings.geminiKeySetAt,
              }
            : settings.apiKeySealed && { hint: settings.apiKeyHint, setAt: settings.apiKeySetAt };
      return {
        id: p.id,
        label: p.label,
        company: p.company,
        keyStarts: p.keyStarts,
        keyPage: p.keyPage,
        key: own
          ? { own: true as const, ...own }
          : p.id === "anthropic" && process.env.AI_API_KEY?.trim()
            ? { own: false as const, hint: null, setAt: null }
            : null,
        test: tests[p.id] ?? null,
        models: read?.models.length ?? null,
      };
    }),
    pinSet: settings.pinHash !== null,
    /** Models with no price that have work: blocked (v6.4 A7). */
    blockedModels: blockedInUse(settings, book),
    allowFable: settings.allowFable,
    assistantName: settings.assistantName,
    replyRemindHours: settings.replyRemindHours,
    morningBrief: settings.morningBrief,
    eveningReport: settings.eveningReport,
    can: { manage: ctx.can("ai.manage") },
  };
}

export type AiStatus = Awaited<ReturnType<typeof getAiStatus>>;

/** Turns all AI on or off for the company (off: no AI call is made). */
export async function setAiSwitch(ctx: CompanyContext, on: boolean, meta?: RequestMeta) {
  assertManage(ctx);
  const now = new Date();
  await saveSettings(ctx, {
    enabled: on,
    changedAt: now,
    changedById: ctx.user.id,
    // Turning it off also ends a pause, so turning it on again starts afresh.
    ...(on ? {} : { pausedAt: null }),
  });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: on ? "Turned AI on" : "Turned AI off",
  });
}

/** Pauses the AI (Mehedi 2.0's Pause, or "stop everything" on the bot), or resumes it. */
export async function setAiPaused(ctx: CompanyContext, paused: boolean, meta?: RequestMeta) {
  assertManage(ctx);
  await saveSettings(ctx, { pausedAt: paused ? new Date() : null });
  await auditInCompany(ctx, meta, {
    action: "STATUS_CHANGE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: paused ? "Paused the AI" : "Resumed the AI",
  });
}

export const apiKeySchema = z.object({
  key: z
    .string()
    .trim()
    .min(20, "Paste the whole key: it starts with sk-ant-")
    .max(300, "This is longer than a Claude key")
    .regex(/^sk-ant-[A-Za-z0-9_-]+$/, "A Claude key starts with sk-ant- and has no spaces"),
});

/** Keeps the company's own Claude key, sealed; only its last four characters are shown. */
export async function setApiKey(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { key } = apiKeySchema.parse(input);
  await saveSettings(ctx, {
    apiKeySealed: encryptSecret(key),
    apiKeyHint: key.slice(-4),
    apiKeySetAt: new Date(),
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Saved a Claude key ending ${key.slice(-4)}`,
  });
}

/** Removes the company's own key (the server's AI_API_KEY then stands in, if set). */
export async function removeApiKey(ctx: CompanyContext, meta?: RequestMeta) {
  assertManage(ctx);
  await saveSettings(ctx, { apiKeySealed: null, apiKeyHint: null, apiKeySetAt: null });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: "Removed the company's Claude key",
  });
}

/** The OpenAI and Gemini keys (Claude's is apiKeySchema). */
export const providerKeySchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("openai"),
    key: z
      .string()
      .trim()
      .min(20, "Paste the whole key: it starts with sk-")
      .max(400, "This is longer than an OpenAI key")
      .regex(/^sk-[A-Za-z0-9_-]+$/, "An OpenAI key starts with sk- and has no spaces"),
  }),
  z.object({
    provider: z.literal("google"),
    key: z
      .string()
      .trim()
      .min(30, "Paste the whole key: it starts with AIza")
      .max(200, "This is longer than a Gemini key")
      .regex(/^[A-Za-z0-9_-]+$/, "A Gemini key has letters, digits, - and _ only, no spaces"),
  }),
]);

const KEY_COLUMNS = {
  openai: { sealed: "openaiKeySealed", hint: "openaiKeyHint", setAt: "openaiKeySetAt" },
  google: { sealed: "geminiKeySealed", hint: "geminiKeyHint", setAt: "geminiKeySetAt" },
} as const;

/** Keeps the company's OpenAI or Gemini key, sealed; only its last four characters are shown. */
export async function setProviderKey(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { provider, key } = providerKeySchema.parse(input);
  const c = KEY_COLUMNS[provider];
  await saveSettings(ctx, {
    [c.sealed]: encryptSecret(key),
    [c.hint]: key.slice(-4),
    [c.setAt]: new Date(),
  });
  await forgetRead(ctx, provider);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Saved ${provider === "openai" ? "an OpenAI" : "a Gemini"} key ending ${key.slice(-4)}`,
  });
}

/** Removes the company's OpenAI or Gemini key: its models run on the task's own Claude model. */
export async function removeProviderKey(
  ctx: CompanyContext,
  provider: unknown,
  meta?: RequestMeta,
) {
  assertManage(ctx);
  const p = z.enum(["openai", "google"]).parse(provider);
  const c = KEY_COLUMNS[p];
  await saveSettings(ctx, { [c.sealed]: null, [c.hint]: null, [c.setAt]: null });
  await forgetRead(ctx, p);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Removed the company's ${providerInfo(p).label} key`,
  });
}

/** A new or removed key: its last Test and the models read with the old key no longer hold. */
async function forgetRead(ctx: CompanyContext, provider: ProviderId) {
  const settings = await aiSettingsOf(ctx.company.id);
  const tests = { ...jsonMap(settings.keyTests) };
  const read = { ...jsonMap(settings.providerModels) };
  delete tests[provider];
  delete read[provider];
  await saveSettings(ctx, {
    keyTests: tests as Prisma.InputJsonValue,
    providerModels: read as Prisma.InputJsonValue,
  });
}

function plainProviderError(provider: ProviderId, error: unknown) {
  const label = providerInfo(provider).label;
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) return `${label} refused the key.`;
    if (error.status === 429) return `${label} says the key is busy or out of credit.`;
    if (error.status === 0) return `${label} could not be reached: ${error.message.slice(0, 120)}`;
    return `${label} answered ${error.status}: ${error.message.slice(0, 160)}`;
  }
  return `${label} could not be asked: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`;
}

/**
 * Tests a provider's key by reading the models it offers (free: no AI work is
 * asked, so it works while AI is off) and keeps the list for Models.
 */
export async function testProviderKey(ctx: CompanyContext, provider: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const p = z.enum(PROVIDER_IDS).parse(provider);
  const settings = await aiSettingsOf(ctx.company.id);
  const key = keyFor(settings, p);
  if (!key) throw new AppError("VALIDATION", `Add the ${providerInfo(p).label} key first.`);
  const at = new Date().toISOString();
  let test: KeyTest;
  let models: ReadModel[] | null = null;
  try {
    models = await listModels(p, key);
    test = {
      ok: true,
      at,
      note: `Works: ${models.length} model${models.length === 1 ? "" : "s"} offered`,
    };
  } catch (error) {
    test = { ok: false, at, note: plainProviderError(p, error) };
  }
  const tests = { ...jsonMap(settings.keyTests), [p]: test };
  const read = models
    ? { ...jsonMap(settings.providerModels), [p]: { readAt: at, models } }
    : jsonMap(settings.providerModels);
  await saveSettings(ctx, {
    keyTests: tests as Prisma.InputJsonValue,
    providerModels: read as Prisma.InputJsonValue,
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Tested the ${providerInfo(p).label} key: ${test.note}`,
  });
  return test;
}

/** Reads the models of every provider that has a key ("Read models from providers"). */
export async function readProviderModels(ctx: CompanyContext, meta?: RequestMeta) {
  assertManage(ctx);
  const settings = await aiSettingsOf(ctx.company.id);
  const out: Array<{ provider: ProviderId; test: KeyTest }> = [];
  for (const p of PROVIDER_IDS) {
    if (!keyFor(settings, p)) continue;
    out.push({ provider: p, test: await testProviderKey(ctx, p, meta) });
  }
  if (out.length === 0)
    throw new AppError("VALIDATION", "Add a key on AI Center > Settings first.");
  return out;
}

/** A model the owner may pick now: one of the ERP's own, or one read from a provider with a key. */
function assertPickable(settings: AiSettings, model: string) {
  if (isBuiltIn(model)) return;
  const ref = parseModel(model);
  if (!ref)
    throw new AppError("VALIDATION", "Pick a model from the list.", {
      model: ["Pick a model from the list"],
    });
  const label = providerInfo(ref.provider).label;
  if (!keyFor(settings, ref.provider)) {
    throw new AppError("VALIDATION", `Add the ${label} key on AI Center > Settings first.`, {
      model: [`Add the ${label} key first`],
    });
  }
  if (!readModelsOf(settings)[ref.provider]?.models.some((m) => m.id === ref.id)) {
    throw new AppError(
      "VALIDATION",
      `${label} did not offer this model to the key: read the models again.`,
      {
        model: ["Read the models again"],
      },
    );
  }
}

/** What the screens call a model, with the names its provider gave. */
function labelIn(settings: Pick<AiSettings, "providerModels">, ref: string) {
  const parsed = parseModel(ref);
  return modelLabel(ref, parsed ? readModelsOf(settings)[parsed.provider]?.models : undefined);
}

/** A model with no price cannot be given work (v6.4 A7). */
async function assertPriced(ctx: CompanyContext, settings: AiSettings, model: string) {
  if (priceFor(await priceBook(ctx.company.id), model)) return;
  throw new AppError("VALIDATION", blockedText(labelIn(settings, model)), {
    model: ["No price: blocked"],
  });
}

export type BlockedModel = { model: string; label: string; where: string[] };

/**
 * The models with no price that have work: the tasks and agents set to them
 * (v6.4 A7). They are blocked, so the owner is warned on AI Home and Models.
 */
export function blockedInUse(settings: AiSettings, book: PriceBook): BlockedModel[] {
  const where = new Map<string, string[]>();
  const note = (model: string, what: string) => {
    if (priceFor(book, model)) return;
    where.set(model, [...(where.get(model) ?? []), what]);
  };
  const chosen = chosenModels(settings);
  for (const t of AI_TASKS) note(modelFor(t.key, chosen, settings.allowFable), t.label);
  const own = agentModelsOf(settings);
  for (const a of aiAgents(settings.assistantName)) {
    if (own[a.key]) note(own[a.key]!, a.name);
  }
  return [...where].map(([model, w]) => ({ model, label: labelIn(settings, model), where: w }));
}

export const modelChoiceSchema = z.object({
  task: z.enum(TASK_KEYS),
  /** null puts the system's choice back. */
  model: z.string().trim().max(140).nullable(),
});

export const agentModelSchema = z.object({
  agent: z.string().trim().min(1).max(60),
  /** null: the agent works on each task's model. */
  model: z.string().trim().max(140).nullable(),
});

type PriceStrings = Record<keyof PriceFields, string | null>;

const priceStrings = (p: PriceFields): PriceStrings =>
  Object.fromEntries(
    PRICE_FIELDS.map((f) => [f, p[f] === null ? null : String(p[f])]),
  ) as PriceStrings;

const NO_PRICE: PriceStrings = Object.fromEntries(
  PRICE_FIELDS.map((f) => [f, null]),
) as PriceStrings;

export type PriceRow = PriceStrings & {
  model: string;
  label: string;
  /** The provider's own name of the model (without the "openai:" part). */
  id: string;
  /** One of the ERP's own Claude models, and its size ("Big"). */
  builtIn: boolean;
  size: string | null;
  /** A task or an agent is set to it. */
  inUse: boolean;
  /** "erp": the price page's price; "owner": the owner's own; "blocked": no price. */
  state: "erp" | "owner" | "blocked";
  /** The price page's price, when the model is on the list (kept in view under the owner's). */
  list: PriceStrings | null;
  /** The prices for a long prompt (the owner's, else the page's), when there are any. */
  long: (PriceStrings & { above: string }) | null;
  /** The other prices that hold: long prompts, an announced change of the page's. */
  notes: string[];
  sourceUrl: string | null;
  checkedOn: string | null;
  /** Who set the owner's price, and when, and where the price came from. */
  setBy: string | null;
  setAt: Date | null;
  source: string | null;
};

/**
 * The Prices sections of Models: per provider, its models on the price list
 * (older ones apart), the models the owner priced, and any model in use with
 * no price (blocked).
 */
async function priceSections(settings: AiSettings, book: PriceBook, inUse: ReadonlySet<string>) {
  const setters = [...new Set([...book.values()].flatMap((p) => (p.setById ? [p.setById] : [])))];
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: setters } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  // Which list entry each model in use is (a Claude snapshot is its model's).
  const used = new Set(
    [...inUse].map((ref) => listedModel(normalModel(ref))?.ref ?? normalModel(ref)),
  );
  const row = (ref: string, price: Price | null): PriceRow => {
    const listed = listedModel(ref);
    return {
      model: ref,
      label: listed?.ref === ref ? listed.label : labelIn(settings, ref),
      id: parseModel(ref)?.id ?? ref,
      builtIn: isBuiltIn(ref),
      size: modelInfo(ref)?.size ?? null,
      inUse: used.has(ref),
      state: price ? price.from : "blocked",
      ...(price ? priceStrings(price) : NO_PRICE),
      list: listed ? priceStrings(listed) : null,
      long: price?.long ? { above: String(price.long.above), ...priceStrings(price.long) } : null,
      notes: price ? priceNotes(price) : [],
      sourceUrl: price?.from === "erp" ? (listed?.sourceUrl ?? null) : null,
      checkedOn: price?.from === "erp" ? (listed?.checkedOn ?? null) : null,
      setBy: price?.from === "owner" ? (names.get(price.setById ?? "") ?? null) : null,
      setAt: price?.from === "owner" ? (price.setAt ?? null) : null,
      source: price?.from === "owner" ? (price.source ?? null) : null,
    };
  };
  return PRICE_LISTS.map((l) => {
    const rows: PriceRow[] = [];
    const older: PriceRow[] = [];
    for (const m of l.models) {
      const r = row(m.ref, priceFor(book, m.ref));
      (m.older && !r.inUse && r.state !== "owner" ? older : rows).push(r);
    }
    const onList = new Set(l.models.map((m) => m.ref));
    const mine = (ref: string) => parseModel(ref)?.provider === l.provider && !onList.has(ref);
    // The owner's prices of models on no list, then models in use with no price.
    for (const ref of [...book.keys()].filter(mine).sort())
      rows.push(row(ref, priceFor(book, ref)));
    for (const ref of [...used].filter((r) => mine(r) && !book.has(r)).sort()) {
      if (!listedModel(ref)) rows.push(row(ref, null));
    }
    return {
      provider: l.provider,
      label: l.label,
      sourceUrl: l.sourceUrl,
      checkedOn: l.checkedOn,
      rows,
      older,
    };
  });
}

/**
 * Models as the screen shows it: per task the system's choice, the owner's and
 * the test standing of the model it runs on; per agent its own model; the
 * models each provider offers (marked when they have no price); the prices of
 * Claude, OpenAI and Gemini models; and the models with no price that have
 * work (blocked).
 */
export async function getModels(ctx: CompanyContext) {
  const [settings, runs, book] = await Promise.all([
    aiSettingsOf(ctx.company.id),
    modelTestRuns(ctx.company.id),
    priceBook(ctx.company.id),
  ]);
  const chosen = chosenModels(settings);
  const agentModels = agentModelsOf(settings);
  const read = readModelsOf(settings);
  const label = (ref: string) => labelIn(settings, ref);
  const priced = (ref: string) => priceFor(book, ref) !== null;
  const providers = PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    hasKey: keyFor(settings, p.id) !== null,
    readAt: read[p.id]?.readAt ?? null,
    models: (read[p.id]?.models ?? [])
      .map((m) => {
        const ref = modelRef(p.id, m.id);
        return { ref, label: m.label, priced: priced(ref) };
      })
      .filter((m) => !BUILT_IN_MODELS.includes(m.ref)),
  }));
  const tasks = AI_TASKS.map((t) => {
    const runsOn = modelFor(t.key, chosen, settings.allowFable);
    const standing = standingOf(runs, t.key, runsOn);
    return {
      key: t.key,
      label: t.label,
      module: t.module,
      system: t.model,
      chosen: chosen[t.key] ?? null,
      runsOn,
      runsOnLabel: label(runsOn),
      blocked: !priced(runsOn),
      test: { ...standing, text: MODEL_TEST_TEXT[standing.state] },
    };
  });
  const agents = aiAgents(settings.assistantName).map((a) => ({
    ...a,
    model: agentModels[a.key] ?? null,
    modelLabel: agentModels[a.key] ? label(agentModels[a.key]!) : null,
    blocked: agentModels[a.key] ? !priced(agentModels[a.key]!) : false,
  }));
  const inUse = new Set<string>([...tasks.map((t) => t.runsOn), ...Object.values(agentModels)]);
  return {
    allowFable: settings.allowFable,
    tasks,
    agents,
    providers,
    priceSections: await priceSections(settings, book, inUse),
    blocked: blockedInUse(settings, book),
    can: { manage: ctx.can("ai.manage") },
  };
}

export type AiModelsScreen = Awaited<ReturnType<typeof getModels>>;

export async function setTaskModel(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { task, model } = modelChoiceSchema.parse(input);
  const settings = await aiSettingsOf(ctx.company.id);
  if (model) {
    assertPickable(settings, model);
    await assertPriced(ctx, settings, model);
  }
  const chosen = chosenModels(settings);
  const system = AI_TASKS.find((t) => t.key === task)!.model;
  if (model === null || model === system) delete chosen[task];
  else chosen[task] = model;
  await saveSettings(ctx, { models: chosen });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `${AI_TASKS.find((t) => t.key === task)!.label}: ${model && model !== system ? model : `back to ${system}`}`,
  });
}

/** Gives an agent its own model (any provider), or puts it back on each task's model. */
export async function setAgentModel(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { agent, model } = agentModelSchema.parse(input);
  const settings = await aiSettingsOf(ctx.company.id);
  const found = aiAgents(settings.assistantName).find((a) => a.key === agent);
  if (!found) throw new AppError("VALIDATION", "Pick one of the agents.");
  if (model) {
    assertPickable(settings, model);
    await assertPriced(ctx, settings, model);
  }
  const chosen = agentModelsOf(settings);
  if (model) chosen[agent] = model;
  else delete chosen[agent];
  await saveSettings(ctx, { agentModels: chosen });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `${found.name}: ${model ? `works on ${model}` : "back to each task's model"}`,
  });
}

/** Lets Fable 5.1 be used for the tasks set to it (it costs the most), or stops it. */
export async function setFableAllowed(ctx: CompanyContext, allowed: boolean, meta?: RequestMeta) {
  assertManage(ctx);
  await saveSettings(ctx, { allowFable: allowed });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: allowed ? "Allowed Fable 5.1" : "Stopped Fable 5.1",
  });
}

export const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, "Use 4 to 8 digits"),
  /** The current PIN, when one is set. */
  current: z.string().optional(),
});

/** Sets (or changes, with the current one) the PIN asked for money, prices and deletions. */
export async function setPin(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { pin, current } = pinSchema.parse(input);
  const settings = await aiSettingsOf(ctx.company.id);
  if (settings.pinHash && !(await checkPin(ctx.company.id, current ?? "", ctx.user.id))) {
    throw new AppError("VALIDATION", "The current PIN is not right.", {
      current: ["The current PIN is not right"],
    });
  }
  await saveSettings(ctx, { pinHash: await hashPassword(pin), pinSetAt: new Date() });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: settings.pinHash ? "Changed the AI PIN" : "Set the AI PIN",
  });
}

/**
 * Whether the PIN is right (never while none is set). At most ten tries in
 * fifteen minutes per person, so it cannot be guessed.
 */
export async function checkPin(companyId: string, pin: string, userId: string): Promise<boolean> {
  const settings = await aiSettingsOf(companyId);
  if (!settings.pinHash) return false;
  checkRateLimit(`ai-pin:${companyId}:${userId}`, 10, 15 * 60_000);
  return /^\d{4,8}$/.test(pin) && verifyPassword(pin, settings.pinHash);
}

/** New numbers the bot may check against the PIN per person and store, in fifteen minutes. */
export const STRAY_PIN_CHECKS = 10;

/** Numbers found not to be the store's PIN (until it changes): checking one again tells nothing new. */
const notThePin = new Map<string, { pinHash: string; numbers: Set<string> }>();

/**
 * Whether digits are the PIN, only for the bot to hide a PIN sent when nothing
 * asked for one (bot/incoming.ts). Ten new numbers in fifteen minutes per
 * person, like checkPin's tries but kept apart, so the bot never uses up the
 * owner's PIN tries in the ERP; a number already found not to be the PIN is
 * free. "unchecked" once they are used up: the bot then hides the message the
 * same way as the PIN, so sending numbers cannot find the PIN.
 */
export async function pinMatches(
  companyId: string,
  pin: string,
  userId: string,
): Promise<boolean | "unchecked"> {
  const settings = await aiSettingsOf(companyId);
  if (!settings.pinHash || !/^\d{4,8}$/.test(pin)) return false;
  let known = notThePin.get(companyId);
  if (known?.pinHash !== settings.pinHash) {
    known = { pinHash: settings.pinHash, numbers: new Set() };
    notThePin.set(companyId, known);
  }
  if (known.numbers.has(pin)) return false;
  try {
    checkRateLimit(`ai-pin-stray:${companyId}:${userId}`, STRAY_PIN_CHECKS, 15 * 60_000);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED") return "unchecked";
    throw error;
  }
  if (await verifyPassword(pin, settings.pinHash)) return true;
  if (known.numbers.size >= 500) known.numbers.clear();
  known.numbers.add(pin);
  return false;
}

/**
 * A PIN the bot already checked when it arrived (bot/incoming.ts): the
 * message itself is never kept, so what follows only learns that it was right.
 * Server code only; nothing a browser sends can be this.
 */
export const PIN_CHECKED: unique symbol = Symbol("pin-checked");

export type PinProof = string | typeof PIN_CHECKED | undefined;

export const PIN_NOT_SET = "Set your PIN first in AI Center > Settings.";

/**
 * The PIN for money, prices, deletions and locked cells, on every path (the
 * ERP, the chat, the bot): it must be set first, and given right. The errors
 * name the field "pin" (or "pinNotSet"), so a screen knows to ask for it.
 */
export async function requirePin(ctx: CompanyContext, pin: PinProof, what: string) {
  if (pin === PIN_CHECKED) return;
  const settings = await aiSettingsOf(ctx.company.id);
  if (!settings.pinHash) {
    throw new AppError("VALIDATION", `${PIN_NOT_SET} It is asked to ${what}.`, {
      pinNotSet: [PIN_NOT_SET],
    });
  }
  if (!pin) {
    throw new AppError("VALIDATION", `Give your PIN to ${what}.`, {
      pin: [`Give your PIN to ${what}`],
    });
  }
  if (!(await checkPin(ctx.company.id, pin, ctx.user.id))) {
    throw new AppError("VALIDATION", "The PIN is not right.", { pin: ["The PIN is not right"] });
  }
}

export const assistantNameSchema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(40, "Use at most 40 characters"),
});

/** The AI's name in this company (on every message and document it writes). */
export async function setAssistantName(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { name } = assistantNameSchema.parse(input);
  await saveSettings(ctx, { assistantName: name });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Named the AI "${name}"`,
  });
}

export const replyRemindSchema = z.object({
  hours: z.coerce
    .number()
    .int("Give whole hours")
    .min(1, "Give at least 1 hour")
    .max(168, "Give at most 168 hours (a week)"),
});

/** After how many hours an unsent buyer draft reminds the owner (24 to start with). */
export async function setReplyRemindHours(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { hours } = replyRemindSchema.parse(input);
  await saveSettings(ctx, { replyRemindHours: hours });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Unsent buyer drafts remind the owner after ${hours} hours`,
  });
}

export const dailyNotesSchema = z.object({
  morningBrief: z.boolean(),
  eveningReport: z.boolean(),
});

/** The morning brief (08:00) and the evening report (19:00) on or off. */
export async function setDailyNotes(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const notes = dailyNotesSchema.parse(input);
  await saveSettings(ctx, notes);
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "AiSettings",
    entityId: ctx.company.id,
    summary: `Morning brief ${notes.morningBrief ? "on" : "off"}, evening report ${notes.eveningReport ? "on" : "off"}`,
  });
}

/** "Mehedi 2.0 (AI)": the label on everything the AI writes. */
export const aiLabel = (settings: Pick<AiSettings, "assistantName">) =>
  `${settings.assistantName} (AI)`;
