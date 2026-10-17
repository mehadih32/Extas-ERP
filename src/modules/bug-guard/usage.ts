import type { UsageKind } from "@prisma/client";
import { z } from "zod";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type { CompanyContext } from "@/modules/auth/context";

import { routeOf } from "./server-errors";

/*
 * How the ERP is used, for Bug Guard's product checks (checks/product.ts):
 * counts per day and store of the screens opened, the forms people typed into
 * and left without saving, and the words searched in Help that found nothing.
 * The browser sends them (components/shell/usage-beacon.tsx); only a screen's
 * route pattern is kept, never what was typed in a form.
 */

export const usageSchema = z.object({
  kind: z.enum(["VIEW", "ABANDONED", "HELP_MISS"]),
  subject: z.string().trim().min(1).max(300),
});

/** What is counted: a screen's route pattern, or Help words in lower case. */
export function usageSubject(kind: UsageKind, subject: string): string | null {
  if (kind === "HELP_MISS") {
    const words = subject.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
    return words.length >= 2 ? words : null;
  }
  const route = routeOf(subject);
  return route.startsWith("/") && !route.startsWith("/api") ? route : null;
}

/** Counts one use (a person's browser sent it). */
export async function recordUsage(ctx: CompanyContext, input: unknown, now: Date = new Date()) {
  const { kind, subject } = usageSchema.parse(input);
  // The Full check's own visits are not people using the ERP.
  if (ctx.session.checkRoleId) return { counted: false };
  // A browser sends a few a minute; more is someone playing with the counts.
  checkRateLimit(`usage:${ctx.session.id}`, 120, 60_000);
  const what = usageSubject(kind, subject);
  if (!what) return { counted: false };
  const day = localDay(now, ctx.company.timezone);
  await prisma.usageCount.upsert({
    where: {
      companyId_day_kind_subject: { companyId: ctx.company.id, day, kind, subject: what },
    },
    create: { companyId: ctx.company.id, day, kind, subject: what, count: 1 },
    update: { count: { increment: 1 } },
  });
  return { counted: true };
}
