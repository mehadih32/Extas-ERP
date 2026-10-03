import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as notes from "@/modules/notepad/note.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/notepad?tab=DAILY_ROUTINE|NEXT_3_DAYS|GENERAL&search= — one tab of the signed-in
 * person's notepad: today's routine with what is ticked, the plan for today and the next two
 * days with overdue items carried over, or the general notes (pinned first).
 */
export const GET = apiRoute(async (request) =>
  notes.listNotes(
    await requirePermission("notepad.use"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/notepad — { tab, content, title?, planDate? (Next 3 days: today, tomorrow or the
 * day after), isPinned? }. Notes are private to the person who writes them.
 */
export const POST = apiRoute(
  async (request) =>
    notes.createNote(await requirePermission("notepad.use"), await readJson(request)),
  { successStatus: 201 },
);
