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

import { AI_TASKS, type AiTaskKey, modelFor, MODEL_IDS, TASK_KEYS } from "./models";

/*
 * A company's AI switch, key, models and PIN (AI Center > Control, Models and
 * Settings). AI starts off: with the switch off or paused nothing calls the
 * AI, every feature falls back to its own non-AI way, and the AI costs nothing.
 * The Claude key is kept sealed (lib/crypto.ts) and never shown again; the
 * server's AI_API_KEY stands in while the company has none of its own. Only
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

export type AiOff = "switched-off" | "paused" | "no-key";

/** Why the AI is not working now, or null when it is. */
export function offReason(settings: AiSettings): AiOff | null {
  if (!settings.enabled) return "switched-off";
  if (settings.pausedAt) return "paused";
  return apiKeyOf(settings) ? null : "no-key";
}

export const OFF_TEXT: Record<AiOff, string> = {
  "switched-off": "AI is switched off. The owner turns it on in AI Center.",
  paused: "AI is paused. The owner resumes it in AI Center.",
  "no-key": "AI has no Claude key yet. The owner adds it in AI Center > Settings.",
};

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
  const settings = await aiSettingsOf(ctx.company.id);
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
    pinSet: settings.pinHash !== null,
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

export const modelChoiceSchema = z.object({
  task: z.enum(TASK_KEYS),
  /** null puts the system's choice back. */
  model: z.enum(MODEL_IDS).nullable(),
});

/** The model per task, as Models shows it: the system's choice and the owner's. */
export async function getModels(ctx: CompanyContext) {
  const settings = await aiSettingsOf(ctx.company.id);
  const chosen = chosenModels(settings);
  return {
    allowFable: settings.allowFable,
    tasks: AI_TASKS.map((t) => ({
      key: t.key,
      label: t.label,
      module: t.module,
      system: t.model,
      chosen: chosen[t.key] ?? null,
      runsOn: modelFor(t.key, chosen, settings.allowFable),
    })),
    can: { manage: ctx.can("ai.manage") },
  };
}

export type AiModelsScreen = Awaited<ReturnType<typeof getModels>>;

export async function setTaskModel(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertManage(ctx);
  const { task, model } = modelChoiceSchema.parse(input);
  const settings = await aiSettingsOf(ctx.company.id);
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
 * Whether the PIN is right (true when none is set yet). At most ten tries in
 * fifteen minutes per person, so it cannot be guessed.
 */
export async function checkPin(companyId: string, pin: string, userId: string): Promise<boolean> {
  const settings = await aiSettingsOf(companyId);
  if (!settings.pinHash) return true;
  checkRateLimit(`ai-pin:${companyId}:${userId}`, 10, 15 * 60_000);
  return /^\d{4,8}$/.test(pin) && verifyPassword(pin, settings.pinHash);
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
