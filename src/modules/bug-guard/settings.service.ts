import { Prisma } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { describeSchedule, nextRunAt, type Schedule, scheduleSchema } from "@/lib/schedule";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Bug Guard's schedule and choices (AI Center > Bug Guard, the platform owner
 * only). It runs on the owner's schedule (every N hours, every N days, weekly
 * on chosen days, or chosen dates and times; default every 3 days at 02:00,
 * Bangladesh time), plus "Run now" in the ERP and on Telegram, and sends a
 * weekly summary even when all is well. Reading never saves anything: the
 * defaults stand until the owner saves or the clock first runs.
 */

export const TIMEZONE = "Asia/Dhaka";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultSchedule(now: Date): Schedule {
  return {
    mode: "DAYS",
    every: 3,
    times: ["02:00"],
    weekdays: [],
    dates: [],
    startDay: localDay(now, TIMEZONE),
  };
}

export function assertPlatform(ctx: CompanyContext) {
  if (!ctx.user.isSuperAdmin) {
    throw new AppError("FORBIDDEN", "Only the platform owner uses Bug Guard.");
  }
}

/** A stored schedule, read back (a broken one falls back to the default). */
export function scheduleOf(raw: Prisma.JsonValue | null | undefined, now: Date): Schedule {
  const parsed = scheduleSchema.safeParse(raw);
  return parsed.success ? parsed.data : defaultSchedule(now);
}

export type GuardSettings = {
  schedule: Schedule;
  timezone: string;
  autoPrepare: boolean;
  weeklyDay: number;
  weeklyTime: string;
  weeklySentOn: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  saved: boolean;
};

/** The company's settings, or the defaults when none are saved yet. */
export async function settingsOf(
  companyId: string,
  now: Date = new Date(),
): Promise<GuardSettings> {
  const row = await prisma.bugGuardSettings.findUnique({ where: { companyId } });
  if (!row) {
    const schedule = defaultSchedule(now);
    return {
      schedule,
      timezone: TIMEZONE,
      autoPrepare: false,
      weeklyDay: 6,
      weeklyTime: "10:00",
      weeklySentOn: null,
      nextRunAt: nextRunAt(schedule, TIMEZONE, now),
      lastRunAt: null,
      saved: false,
    };
  }
  return {
    schedule: scheduleOf(row.schedule, now),
    timezone: row.timezone,
    autoPrepare: row.autoPrepare,
    weeklyDay: row.weeklyDay,
    weeklyTime: row.weeklyTime,
    weeklySentOn: row.weeklySentOn,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    saved: true,
  };
}

/** The clock makes the row with the defaults for a company that has none, so the default runs. */
export async function ensureSettings(companyId: string, now: Date = new Date()) {
  const schedule = defaultSchedule(now);
  return prisma.bugGuardSettings.upsert({
    where: { companyId },
    create: {
      companyId,
      schedule: schedule as unknown as Prisma.InputJsonObject,
      nextRunAt: nextRunAt(schedule, TIMEZONE, now),
    },
    update: {},
  });
}

export const settingsSchema = z.object({
  schedule: scheduleSchema,
  autoPrepare: z.boolean().default(false),
  weeklyDay: z.coerce.number().int().min(0).max(6).default(6),
  weeklyTime: z.string().trim().regex(TIME, "Use a time like 10:00").default("10:00"),
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Save" on Bug Guard's schedule. */
export async function saveSettings(ctx: CompanyContext, input: unknown, meta?: RequestMeta) {
  assertPlatform(ctx);
  const s = settingsSchema.parse(input);
  const now = new Date();
  // An every-N-days schedule counts from today unless a start day was given.
  const schedule: Schedule =
    s.schedule.mode === "DAYS" && s.schedule.every > 1 && !s.schedule.startDay
      ? { ...s.schedule, startDay: localDay(now, TIMEZONE) }
      : s.schedule;
  const next = nextRunAt(schedule, TIMEZONE, now);
  const data = {
    schedule: schedule as unknown as Prisma.InputJsonObject,
    autoPrepare: s.autoPrepare,
    weeklyDay: s.weeklyDay,
    weeklyTime: s.weeklyTime,
    nextRunAt: next,
    updatedById: ctx.user.id,
  };
  await prisma.bugGuardSettings.upsert({
    where: { companyId: ctx.company.id },
    create: { companyId: ctx.company.id, ...data },
    update: data,
  });
  const summary = [
    `Schedule: ${describeSchedule(schedule)}`,
    `weekly summary on ${DAYS[s.weeklyDay]} at ${s.weeklyTime}`,
    `opens fixes and prepares corrections by itself: ${s.autoPrepare ? "on" : "off"}`,
  ].join("; ");
  await prisma.bugGuardEvent.create({
    data: { companyId: ctx.company.id, kind: "SETTINGS", byId: ctx.user.id, summary },
  });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "BugGuardSettings",
    entityId: ctx.company.id,
    summary: `Bug Guard: ${summary}`,
  });
  return { nextRunAt: next, schedule: describeSchedule(schedule) };
}
