import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as notes from "@/modules/notepad/note.service";

export const dynamic = "force-dynamic";

/** POST /api/notepad/reorder — { tab, ids: [top first] }: puts a tab's notes in this order. */
export const POST = apiRoute(async (request) =>
  notes.reorderNotes(await requirePermission("notepad.use"), await readJson(request)),
);
