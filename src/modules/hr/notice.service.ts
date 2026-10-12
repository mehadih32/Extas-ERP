import type { Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr } from "@/modules/hr/access";
import {
  listNoticesSchema,
  postNoticeSchema,
  readNoticesSchema,
  updateNoticeSchema,
} from "@/modules/hr/schemas";
import { pushToUsers } from "@/modules/integrations/push";
import { activeMembers } from "@/modules/reminders/audience";
import { sendInApp } from "@/modules/reminders/notification.service";

/*
 * The staff notice board: HR posts a notice for every employee (an office
 * closure, a new rule, Eid bonus dates), staff read it in My HR > Notices and
 * HR sees who has read it. A new notice reaches each employee's in-app inbox,
 * and their phone once push notifications are connected.
 *
 *   hr.manage    posts, edits, pins and takes notices down; sees who read them
 *   portal.self  reads the notices that are up; the first read is recorded
 *
 * A notice is up from when it is posted until its last day ("Show until"), or
 * until HR takes it down. Taking down keeps it, with who read it, for the record.
 */

const noticeInclude = {
  createdBy: { select: { id: true, name: true } },
  takenDownBy: { select: { id: true, name: true } },
} satisfies Prisma.NoticeInclude;

type NoticeRow = Prisma.NoticeGetPayload<{ include: typeof noticeInclude }>;

export type NoticeState = "UP" | "ENDED" | "TAKEN_DOWN";

const today = (ctx: CompanyContext, now: Date) => localDay(now, ctx.company.timezone);

/** Notices staff see on `day`. */
const upOn = (day: string): Prisma.NoticeWhereInput => ({
  takenDownAt: null,
  OR: [{ showUntil: null }, { showUntil: { gte: dateColumn(day) } }],
});

/** Pinned first, then the newest. */
const boardOrder: Prisma.NoticeOrderByWithRelationInput[] = [
  { pinned: "desc" },
  { createdAt: "desc" },
  { id: "asc" },
];

function stateOf(n: Pick<NoticeRow, "takenDownAt" | "showUntil">, day: string): NoticeState {
  if (n.takenDownAt) return "TAKEN_DOWN";
  return n.showUntil && dateOnly(n.showUntil) < day ? "ENDED" : "UP";
}

function present(n: NoticeRow, day: string) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    /** The last day staff see it ("2026-10-20"), or null for no end. */
    showUntil: dateOnly(n.showUntil),
    state: stateOf(n, day),
    postedBy: n.createdBy?.name ?? null,
    createdAt: n.createdAt,
    editedAt: n.editedAt,
    takenDownAt: n.takenDownAt,
    takenDownBy: n.takenDownBy?.name ?? null,
  };
}

export type NoticeView = ReturnType<typeof present>;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Who the board is for on `day`: current employees whose login can sign in
 * and open My HR. Staff without one are counted, to be told another way.
 */
export async function noticeAudience(companyId: string, day: string, db: Db = prisma) {
  const [staff, members] = await Promise.all([
    db.employee.findMany({
      where: {
        companyId,
        // On staff as the employee list counts it: someone serving notice still reads them.
        joinDate: { lte: dateColumn(day) },
        OR: [{ exitDate: null }, { exitDate: { gte: dateColumn(day) } }],
      },
      select: { id: true, code: true, name: true, userId: true },
      orderBy: { name: "asc" },
    }),
    activeMembers(companyId, db),
  ]);
  const canRead = new Set(
    members.filter((m) => m.permissions.has("portal.self")).map((m) => m.userId),
  );
  const reached = staff.flatMap((e) =>
    e.userId && canRead.has(e.userId) ? [{ ...e, userId: e.userId }] : [],
  );
  return { reached, noLogin: staff.length - reached.length };
}

async function loadNotice(ctx: CompanyContext, noticeId: string): Promise<NoticeRow> {
  const notice = await ctx.db.notice.findUnique({
    where: { id: noticeId },
    include: noticeInclude,
  });
  if (!notice) throw new AppError("NOT_FOUND", "Notice not found.");
  return notice;
}

function assertShowUntil(showUntil: string | null | undefined, day: string) {
  if (showUntil && showUntil < day) {
    throw new AppError("VALIDATION", "The last day to show it has passed.", {
      showUntil: ["Pick today or a later day"],
    });
  }
}

/** HR posts a notice: every employee with a login is told in the app (and by push, once on). */
export async function postNotice(
  ctx: CompanyContext,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  assertCanManageHr(ctx, "Only HR can post notices.");
  const input = postNoticeSchema.parse(raw);
  const day = today(ctx, now);
  assertShowUntil(input.showUntil, day);
  const audience = await noticeAudience(ctx.company.id, day);
  const others = audience.reached.filter((e) => e.userId !== ctx.user.id);
  const notice = await prisma.$transaction(async (tx) => {
    const row = await tx.notice.create({
      data: {
        companyId: ctx.company.id,
        title: input.title,
        body: input.body,
        pinned: input.pinned,
        showUntil: input.showUntil ? dateColumn(input.showUntil) : null,
        createdById: ctx.user.id,
        createdAt: now,
        // Whoever writes it has read it.
        reads: { create: { companyId: ctx.company.id, userId: ctx.user.id, readAt: now } },
      },
      include: noticeInclude,
    });
    await sendInApp(
      tx,
      ctx.company.id,
      others.map((e) => ({ userId: e.userId, employeeId: e.id })),
      {
        subject: `Notice: ${input.title}`,
        body: input.body,
        entityType: "Notice",
        entityId: row.id,
      },
      now,
    );
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Notice",
        entityId: row.id,
        summary: `Posted notice "${input.title}"${input.pinned ? " (pinned)" : ""}${
          input.showUntil ? `, shown until ${input.showUntil}` : ""
        } for ${audience.reached.length} staff`,
      },
      tx,
    );
    return row;
  });
  await pushToUsers(
    others.map((e) => e.userId),
    { title: `Notice: ${input.title}`, body: clip(input.body, 140), url: "/me/notices" },
  );
  return { notice: present(notice, day), told: others.length, noLogin: audience.noLogin };
}

/** HR changes a notice that is still up or ended (not one taken down). */
export async function updateNotice(
  ctx: CompanyContext,
  noticeId: string,
  raw: unknown,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  assertCanManageHr(ctx, "Only HR can change notices.");
  const input = updateNoticeSchema.parse(raw);
  const notice = await loadNotice(ctx, noticeId);
  if (notice.takenDownAt) {
    throw new AppError("CONFLICT", "This notice was taken down. Put it back up to change it.");
  }
  const day = today(ctx, now);
  if (input.showUntil !== undefined && input.showUntil !== dateOnly(notice.showUntil)) {
    assertShowUntil(input.showUntil, day);
  }
  const reworded =
    (input.title !== undefined && input.title !== notice.title) ||
    (input.body !== undefined && input.body !== notice.body);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.notice.update({
      where: { id: notice.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.showUntil !== undefined
          ? { showUntil: input.showUntil ? dateColumn(input.showUntil) : null }
          : {}),
        ...(reworded ? { editedAt: now } : {}),
      },
      include: noticeInclude,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Notice",
        entityId: notice.id,
        summary: `Changed notice "${row.title}": ${Object.keys(input).join(", ")}`,
      },
      tx,
    );
    return row;
  });
  return present(updated, day);
}

/** HR takes a notice down: staff no longer see it; it is kept with who read it. */
export async function takeDownNotice(
  ctx: CompanyContext,
  noticeId: string,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  assertCanManageHr(ctx, "Only HR can take notices down.");
  const notice = await loadNotice(ctx, noticeId);
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.notice.updateMany({
      where: { id: notice.id, companyId: ctx.company.id, takenDownAt: null },
      data: { takenDownAt: now, takenDownById: ctx.user.id },
    });
    if (count === 0) throw new AppError("CONFLICT", "This notice is already taken down.");
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Notice",
        entityId: notice.id,
        summary: `Took down notice "${notice.title}"`,
      },
      tx,
    );
    return tx.notice.findUniqueOrThrow({ where: { id: notice.id }, include: noticeInclude });
  });
  return present(updated, today(ctx, now));
}

/** HR puts a notice taken down back up (staff see it again unless its last day has passed). */
export async function putBackNotice(
  ctx: CompanyContext,
  noticeId: string,
  meta?: RequestMeta,
  now: Date = new Date(),
) {
  assertCanManageHr(ctx, "Only HR can put notices back up.");
  const notice = await loadNotice(ctx, noticeId);
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.notice.updateMany({
      where: { id: notice.id, companyId: ctx.company.id, takenDownAt: { not: null } },
      data: { takenDownAt: null, takenDownById: null },
    });
    if (count === 0) throw new AppError("CONFLICT", "This notice is up already.");
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "Notice",
        entityId: notice.id,
        summary: `Put notice "${notice.title}" back up`,
      },
      tx,
    );
    return tx.notice.findUniqueOrThrow({ where: { id: notice.id }, include: noticeInclude });
  });
  return present(updated, today(ctx, now));
}

/** How many notices HR keeps on one page of the board's list. */
export const NOTICE_PAGE = 50;

/**
 * HR's list: the notices up now (or ended and taken down, or all), each with
 * how many of the staff have read it, who and when, and who has not yet.
 */
export async function listNotices(ctx: CompanyContext, raw: unknown = {}, now: Date = new Date()) {
  assertCanManageHr(ctx, "Only HR can see who has read the notices.");
  const { show } = listNoticesSchema.parse(raw);
  const day = today(ctx, now);
  const up = upOn(day);
  const where: Prisma.NoticeWhereInput =
    show === "current" ? up : show === "ended" ? { NOT: up } : {};
  const [rows, upCount, endedCount, audience] = await Promise.all([
    ctx.db.notice.findMany({
      where,
      include: noticeInclude,
      orderBy: show === "current" ? boardOrder : [{ createdAt: "desc" }, { id: "asc" }],
      take: NOTICE_PAGE,
    }),
    ctx.db.notice.count({ where: up }),
    ctx.db.notice.count({ where: { NOT: up } }),
    noticeAudience(ctx.company.id, day),
  ]);
  const reads = await ctx.db.noticeRead.findMany({
    where: { noticeId: { in: rows.map((r) => r.id) } },
    select: { noticeId: true, userId: true, readAt: true },
    orderBy: { readAt: "asc" },
  });
  const readsOf = new Map<string, Map<string, Date>>();
  for (const r of reads) {
    const of = readsOf.get(r.noticeId) ?? new Map<string, Date>();
    of.set(r.userId, r.readAt);
    readsOf.set(r.noticeId, of);
  }
  return {
    show,
    counts: { up: upCount, ended: endedCount },
    audience: { reached: audience.reached.length, noLogin: audience.noLogin },
    items: rows.map((n) => {
      const of = readsOf.get(n.id) ?? new Map<string, Date>();
      const readBy = audience.reached
        .filter((e) => of.has(e.userId))
        .map((e) => ({ employeeId: e.id, name: e.name, readAt: of.get(e.userId)! }))
        .sort((a, b) => a.readAt.getTime() - b.readAt.getTime());
      const notYet = audience.reached
        .filter((e) => !of.has(e.userId))
        .map((e) => ({ employeeId: e.id, name: e.name }));
      return { ...present(n, day), readBy, notYet };
    }),
    /** Only the latest NOTICE_PAGE are listed. */
    more: rows.length === NOTICE_PAGE,
  };
}

export type NoticeList = Awaited<ReturnType<typeof listNotices>>;

/** The notices up now for the signed-in person, pinned first, with which they have read. */
export async function myNotices(ctx: CompanyContext, now: Date = new Date()) {
  const day = today(ctx, now);
  const rows = await ctx.db.notice.findMany({
    where: upOn(day),
    include: {
      ...noticeInclude,
      reads: { where: { userId: ctx.user.id }, select: { readAt: true } },
    },
    orderBy: boardOrder,
    take: NOTICE_PAGE,
  });
  const items = rows.map((n) => ({
    ...present(n, day),
    /** When this person first read it (null: new to them). */
    readAt: n.reads[0]?.readAt ?? null,
  }));
  return { items, unread: items.filter((n) => n.readAt === null).length };
}

export type MyNotices = Awaited<ReturnType<typeof myNotices>>;

/**
 * The notices on the person's screen are marked read (the first time counts).
 * Only notices that are up now; returns how many were read for the first time.
 */
export async function markNoticesRead(
  ctx: CompanyContext,
  raw: unknown,
  now: Date = new Date(),
): Promise<{ read: number }> {
  const { noticeIds } = readNoticesSchema.parse(raw);
  if (noticeIds.length === 0) return { read: 0 };
  const up = await ctx.db.notice.findMany({
    where: { AND: [{ id: { in: noticeIds } }, upOn(today(ctx, now))] },
    select: { id: true },
  });
  if (up.length === 0) return { read: 0 };
  const { count } = await ctx.db.noticeRead.createMany({
    data: up.map((n) => ({
      companyId: ctx.company.id,
      noticeId: n.id,
      userId: ctx.user.id,
      readAt: now,
    })),
    skipDuplicates: true,
  });
  return { read: count };
}
