import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as notes from "@/modules/notepad/note.service";

type Params = { noteId: string };

export const dynamic = "force-dynamic";

/** POST /api/notepad/:noteId/done — { done }. A daily routine item is ticked for today only. */
export const POST = apiRoute<Params>(async (request, { noteId }) =>
  notes.markNote(await requirePermission("notepad.use"), noteId, await readJson(request)),
);
