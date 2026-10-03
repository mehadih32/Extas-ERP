import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as notes from "@/modules/notepad/note.service";

type Params = { noteId: string };

export const dynamic = "force-dynamic";

/** PATCH /api/notepad/:noteId — { title?, content?, planDate?, isPinned?, tab? (move it) }. */
export const PATCH = apiRoute<Params>(async (request, { noteId }) =>
  notes.updateNote(await requirePermission("notepad.use"), noteId, await readJson(request)),
);

/** DELETE /api/notepad/:noteId — removes one of your notes. */
export const DELETE = apiRoute<Params>(async (_request, { noteId }) =>
  notes.deleteNote(await requirePermission("notepad.use"), noteId),
);
