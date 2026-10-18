import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { standbyMark } from "@/modules/backups/standby";

// Always run at request time; never cache a health result.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — confirms the app is running and can reach PostgreSQL.
 * Used by Docker health checks and uptime monitoring on the VPS. On standby after
 * a restore it also gives the standby mark's id (no secret), so deploy/go-live.sh
 * can tell that the web address reaches this server.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const standby = await standbyMark();
    return NextResponse.json({
      status: "ok",
      database: "connected",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      ...(standby ? { standby: standby.id } : {}),
    });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json(
      { status: "error", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
