import type { Note, NoteTab } from "@prisma/client";

import { dateColumn, dateOnly, daysBetween, localDay, nextDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import {
  createNoteSchema,
  listNotesSchema,
  markNoteSchema,
  reorderNotesSchema,
  updateNoteSchema,
} from "@/modules/notepad/schemas";

/*
 * The Digital Notepad & Planner (blueprint section 7): three tabs per person.
 *   DAILY_ROUTINE  a checklist for every day: ticking an item marks it done for
 *                  today only (doneOn), so the list starts fresh each morning.
 *   NEXT_3_DAYS    the work plan for today, tomorrow and the day after; items
 *                  not done by their day are carried over as overdue.
 *   GENERAL        free notes, pinned ones first.
 * Notes are private: each person only ever sees and changes their own, so
 * another person's note answers "not found". Days are in company time.
 */

export const MAX_NOTES_PER_TAB = 300;
/** How many days the work plan covers, today included. */
export const PLAN_DAYS = 3;

type NoteRow = Note;

function present(note: NoteRow, today: string) {
  return {
    id: note.id,
    tab: note.tab,
    title: note.title,
    content: note.content,
    planDate: dateOnly(note.planDate),
    /** Routines: done today; other notes: ticked. */
    done: note.tab === "DAILY_ROUTINE" ? dateOnly(note.doneOn) === today : note.isDone,
    /** Routines: the last day it was ticked. */
    lastDoneOn: note.tab === "DAILY_ROUTINE" ? dateOnly(note.doneOn) : null,
    isPinned: note.isPinned,
    sortOrder: note.sortOrder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export type NoteView = ReturnType<typeof present>;

/** The days of the work plan: today and the next ones ("2026-10-02", ...). */
export function planDays(today: string): string[] {
  const days = [today];
  while (days.length < PLAN_DAYS) days.push(nextDay(days[days.length - 1]!));
  return days;
}

function assertPlanDay(day: string, today: string) {
  const offset = daysBetween(today, day);
  if (offset < 0 || offset >= PLAN_DAYS) {
    throw new AppError("VALIDATION", "Plan items are for today, tomorrow or the day after.", {
      planDate: ["Pick today, tomorrow or the day after"],
    });
  }
}

async function ownNote(ctx: CompanyContext, noteId: string): Promise<NoteRow> {
  const note = await ctx.db.note.findFirst({ where: { id: noteId, userId: ctx.user.id } });
  if (!note) throw new AppError("NOT_FOUND", "Note not found.");
  return note;
}

/** One tab of the signed-in person's notepad. */
export async function listNotes(ctx: CompanyContext, raw: unknown, now: Date = new Date()) {
  const input = listNotesSchema.parse(raw);
  const today = localDay(now, ctx.company.timezone);
  const mine = { userId: ctx.user.id, tab: input.tab };

  if (input.tab === "DAILY_ROUTINE") {
    const notes = await ctx.db.note.findMany({
      where: mine,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const items = notes.map((n) => present(n, today));
    return {
      tab: input.tab,
      date: today,
      items,
      done: items.filter((i) => i.done).length,
      total: items.length,
    };
  }

  if (input.tab === "NEXT_3_DAYS") {
    const days = planDays(today);
    const notes = await ctx.db.note.findMany({
      where: {
        ...mine,
        OR: [
          { planDate: { gte: dateColumn(today), lte: dateColumn(days[days.length - 1]!) } },
          // Not done by its day: carried over.
          { planDate: { lt: dateColumn(today) }, isDone: false },
        ],
      },
      orderBy: [{ planDate: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const items = notes.map((n) => present(n, today));
    return {
      tab: input.tab,
      date: today,
      overdue: items.filter((i) => i.planDate! < today),
      days: days.map((date) => ({ date, items: items.filter((i) => i.planDate === date) })),
    };
  }

  const notes = await ctx.db.note.findMany({
    where: {
      ...mine,
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search, mode: "insensitive" } },
              { content: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
  });
  return { tab: input.tab, date: today, items: notes.map((n) => present(n, today)) };
}

async function nextSortOrder(ctx: CompanyContext, tab: NoteTab): Promise<number> {
  const last = await ctx.db.note.aggregate({
    where: { userId: ctx.user.id, tab },
    _max: { sortOrder: true },
    _count: { _all: true },
  });
  if (last._count._all >= MAX_NOTES_PER_TAB) {
    throw new AppError(
      "VALIDATION",
      `This tab already has ${MAX_NOTES_PER_TAB} notes. Delete some before adding more.`,
    );
  }
  return (last._max.sortOrder ?? -1) + 1;
}

export async function createNote(ctx: CompanyContext, raw: unknown, now: Date = new Date()) {
  const input = createNoteSchema.parse(raw);
  const today = localDay(now, ctx.company.timezone);
  if (input.tab === "NEXT_3_DAYS") {
    if (!input.planDate) {
      throw new AppError("VALIDATION", "Pick the day this is planned for.", {
        planDate: ["Required for the work plan"],
      });
    }
    assertPlanDay(input.planDate, today);
  }
  const note = await ctx.db.note.create({
    data: {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      tab: input.tab,
      title: input.title || null,
      content: input.content,
      planDate: input.tab === "NEXT_3_DAYS" ? dateColumn(input.planDate!) : null,
      isPinned: input.isPinned ?? false,
      sortOrder: await nextSortOrder(ctx, input.tab),
    },
  });
  return present(note, today);
}

export async function updateNote(
  ctx: CompanyContext,
  noteId: string,
  raw: unknown,
  now: Date = new Date(),
) {
  const input = updateNoteSchema.parse(raw);
  const today = localDay(now, ctx.company.timezone);
  const note = await ownNote(ctx, noteId);
  const tab = input.tab ?? note.tab;
  const moved = tab !== note.tab;

  let planDate: Date | null = note.planDate;
  if (tab === "NEXT_3_DAYS") {
    const day = input.planDate ?? (moved ? undefined : dateOnly(note.planDate));
    if (!day) {
      throw new AppError("VALIDATION", "Pick the day this is planned for.", {
        planDate: ["Required for the work plan"],
      });
    }
    // An overdue item may keep its old day; a new day must be in the plan.
    if (input.planDate !== undefined || moved) assertPlanDay(day, today);
    planDate = dateColumn(day);
  } else {
    if (input.planDate !== undefined) {
      throw new AppError("VALIDATION", "Only work plan items have a day.", {
        planDate: ["Only for the Next 3 days tab"],
      });
    }
    planDate = null;
  }

  const updated = await ctx.db.note.update({
    where: { id: note.id },
    data: {
      tab,
      planDate,
      ...(input.title !== undefined ? { title: input.title || null } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      // A note moved to another tab starts there unticked, at the end.
      ...(moved ? { isDone: false, doneOn: null, sortOrder: await nextSortOrder(ctx, tab) } : {}),
    },
  });
  return present(updated, today);
}

/** Ticks or unticks a note; a routine item is ticked for today only. */
export async function markNote(
  ctx: CompanyContext,
  noteId: string,
  raw: unknown,
  now: Date = new Date(),
) {
  const { done } = markNoteSchema.parse(raw);
  const today = localDay(now, ctx.company.timezone);
  const note = await ownNote(ctx, noteId);
  const updated = await ctx.db.note.update({
    where: { id: note.id },
    data:
      note.tab === "DAILY_ROUTINE" ? { doneOn: done ? dateColumn(today) : null } : { isDone: done },
  });
  return present(updated, today);
}

export async function deleteNote(ctx: CompanyContext, noteId: string) {
  const note = await ownNote(ctx, noteId);
  await ctx.db.note.delete({ where: { id: note.id } });
  return { id: note.id, deleted: true };
}

/** Puts a tab's notes in the given order (the ids of all or some of them, top first). */
export async function reorderNotes(ctx: CompanyContext, raw: unknown) {
  const input = reorderNotesSchema.parse(raw);
  const ids = [...new Set(input.ids)];
  const found = await ctx.db.note.findMany({
    where: { id: { in: ids }, userId: ctx.user.id, tab: input.tab },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new AppError("NOT_FOUND", "Some of these notes were not found in this tab.");
  }
  await prisma.$transaction(
    ids.map((id, sortOrder) =>
      prisma.note.updateMany({
        where: { id, companyId: ctx.company.id, userId: ctx.user.id },
        data: { sortOrder },
      }),
    ),
  );
  return { tab: input.tab, ids };
}
