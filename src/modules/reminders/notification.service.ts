import type { NotificationLog } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import type { CompanyContext } from "@/modules/auth/context";
import { listNotificationsSchema } from "@/modules/reminders/schemas";

/*
 * The in-app inbox: reminders that fired, tasks assigned or finished. Each person
 * sees only their own messages in the company they are working in. WhatsApp and
 * email copies come with the integrations stage; the log already has room for them.
 */

export type InAppMessage = {
  subject: string;
  body: string;
  /** The record it is about, so the app can open it ("Task", "ProductionProject"...). */
  entityType?: string | null;
  entityId?: string | null;
  reminderId?: string | null;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Puts a message in each recipient's inbox. Pass a transaction to keep it with the change. */
export async function sendInApp(
  db: Db,
  companyId: string,
  recipients: ReadonlyArray<{ userId: string; employeeId?: string | null }>,
  message: InAppMessage,
  now: Date = new Date(),
): Promise<number> {
  const seen = new Set<string>();
  const rows = recipients.filter((r) => !seen.has(r.userId) && seen.add(r.userId));
  if (rows.length === 0) return 0;
  const { count } = await db.notificationLog.createMany({
    data: rows.map((r) => ({
      companyId,
      channel: "IN_APP" as const,
      recipient: r.userId,
      userId: r.userId,
      employeeId: r.employeeId ?? null,
      subject: clip(message.subject, 200),
      body: clip(message.body, 2000),
      entityType: message.entityType ?? null,
      entityId: message.entityId ?? null,
      reminderId: message.reminderId ?? null,
      status: "DELIVERED" as const,
      sentAt: now,
    })),
  });
  return count;
}

function present(n: NotificationLog) {
  return {
    id: n.id,
    subject: n.subject,
    body: n.body,
    read: n.readAt !== null,
    readAt: n.readAt,
    createdAt: n.createdAt,
    /** What to open: { type: "Task", id }. */
    link: n.entityType && n.entityId ? { type: n.entityType, id: n.entityId } : null,
    reminderId: n.reminderId,
  };
}

const mine = (ctx: CompanyContext) => ({ userId: ctx.user.id, channel: "IN_APP" as const });

/** Your messages, newest first, with how many are unread. */
export async function listNotifications(ctx: CompanyContext, raw: unknown = {}) {
  const input = listNotificationsSchema.parse(raw);
  const [rows, unread] = await Promise.all([
    ctx.db.notificationLog.findMany({
      where: { ...mine(ctx), ...(input.unread ? { readAt: null } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.take + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    }),
    ctx.db.notificationLog.count({ where: { ...mine(ctx), readAt: null } }),
  ]);
  const hasMore = rows.length > input.take;
  const items = hasMore ? rows.slice(0, input.take) : rows;
  return {
    items: items.map(present),
    unread,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  };
}

export async function unreadCount(ctx: CompanyContext) {
  return { unread: await ctx.db.notificationLog.count({ where: { ...mine(ctx), readAt: null } }) };
}

export async function markNotificationRead(
  ctx: CompanyContext,
  notificationId: string,
  now: Date = new Date(),
) {
  const own = await ctx.db.notificationLog.findFirst({
    where: { id: notificationId, ...mine(ctx) },
  });
  if (!own) throw new AppError("NOT_FOUND", "Notification not found.");
  if (own.readAt) return present(own);
  const updated = await ctx.db.notificationLog.update({
    where: { id: own.id },
    data: { readAt: now, status: "READ" },
  });
  return present(updated);
}

export async function markAllNotificationsRead(ctx: CompanyContext, now: Date = new Date()) {
  const { count } = await ctx.db.notificationLog.updateMany({
    where: { ...mine(ctx), readAt: null },
    data: { readAt: now, status: "READ" },
  });
  return { updated: count, unread: 0 };
}
