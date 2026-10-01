import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Always run at request time; never cache a health result.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — confirms the app is running and can reach PostgreSQL.
 * Used by Docker health checks and uptime monitoring on the VPS.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "connected",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] database check failed", error);
    return NextResponse.json(
      { status: "error", database: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
