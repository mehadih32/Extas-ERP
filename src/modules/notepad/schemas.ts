import { NoteTab } from "@prisma/client";
import { z } from "zod";

const id = z.string().trim().min(1).max(64);
const day = z.iso.date();

export const listNotesSchema = z.object({
  tab: z.enum(NoteTab),
  /** General notes: words to look for in the title or the text. */
  search: z.string().trim().max(100).optional(),
});

export const createNoteSchema = z.object({
  tab: z.enum(NoteTab),
  title: z.string().trim().max(200).nullish(),
  content: z.string().trim().min(1, "Write something").max(5000),
  /** Next 3 days: the day it is planned for (today, tomorrow or the day after). */
  planDate: day.optional(),
  isPinned: z.boolean().optional(),
});

export const updateNoteSchema = z
  .object({
    /** Moving a note to another tab (a plan item needs a planDate). */
    tab: z.enum(NoteTab).optional(),
    title: z.string().trim().max(200).nullish(),
    content: z.string().trim().min(1, "Write something").max(5000).optional(),
    planDate: day.optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change");

export const markNoteSchema = z.object({ done: z.boolean() });

export const reorderNotesSchema = z.object({
  tab: z.enum(NoteTab),
  /** The tab's notes in their new order. */
  ids: z.array(id).min(1).max(300),
});
