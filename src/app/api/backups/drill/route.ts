import { NextResponse } from "next/server";

import { drillAnswer } from "@/modules/backups/server-drill";
import { drillInfo } from "@/modules/backups/standby";

// Always read at request time: the drill's result arrives when it finishes.
export const dynamic = "force-dynamic";

/**
 * GET /api/backups/drill: on a restore drill copy (deploy/bootstrap.sh --drill),
 * the drill's time and result, so the real ERP's "Record a drill" can read them.
 * No sign-in: it holds no secret and no business data, only the drill's own
 * record. Any other ERP answers 404.
 */
export async function GET() {
  const drill = await drillInfo();
  if (!drill) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "This is not a restore drill copy." } },
      { status: 404 },
    );
  }
  return NextResponse.json(drillAnswer(drill), { headers: { "Cache-Control": "no-store" } });
}
