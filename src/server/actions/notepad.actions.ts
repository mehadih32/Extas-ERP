"use server";

import { runAction } from "@/lib/result";
import { requirePermission } from "@/modules/auth/context";
import * as notes from "@/modules/notepad/note.service";

/*
 * Notepad & planner Server Actions (notepad.use): the signed-in person's own notes
 * in three tabs (daily routine, next 3 days, general). Each returns
 * { ok: true, data } or { ok: false, error }.
 */

const me = () => requirePermission("notepad.use");

export const listNotesAction = async (query: unknown) =>
  runAction(async () => notes.listNotes(await me(), query));
export const createNoteAction = async (input: unknown) =>
  runAction(async () => notes.createNote(await me(), input));
export const updateNoteAction = async (noteId: string, input: unknown) =>
  runAction(async () => notes.updateNote(await me(), noteId, input));
export const markNoteAction = async (noteId: string, input: unknown) =>
  runAction(async () => notes.markNote(await me(), noteId, input));
export const deleteNoteAction = async (noteId: string) =>
  runAction(async () => notes.deleteNote(await me(), noteId));
export const reorderNotesAction = async (input: unknown) =>
  runAction(async () => notes.reorderNotes(await me(), input));
