"use server";

import { revalidatePath } from "next/cache";

import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as notes from "@/modules/notepad/note.service";
import * as screens from "@/modules/reminders/screens.service";

/*
 * Notepad & planner Server Actions (notepad.use): the signed-in person's own notes
 * in three tabs (daily routine, next 3 days, general). Each returns
 * { ok: true, data } or { ok: false, error }. Changes refresh the screens.
 */

const me = () => requirePermission("notepad.use");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

export const getNotepadScreenAction = async (query: { tab?: unknown; search?: unknown } = {}) =>
  runAction(async () => screens.getNotepadScreen(await me(), query));
export const listNotesAction = async (query: unknown) =>
  runAction(async () => notes.listNotes(await me(), query));
export const createNoteAction = async (input: unknown) =>
  change(async () => notes.createNote(await me(), input));
export const updateNoteAction = async (noteId: string, input: unknown) =>
  change(async () => notes.updateNote(await me(), noteId, input));
export const markNoteAction = async (noteId: string, input: unknown) =>
  change(async () => notes.markNote(await me(), noteId, input));
export const deleteNoteAction = async (noteId: string) =>
  change(async () => notes.deleteNote(await me(), noteId));
export const reorderNotesAction = async (input: unknown) =>
  change(async () => notes.reorderNotes(await me(), input));
