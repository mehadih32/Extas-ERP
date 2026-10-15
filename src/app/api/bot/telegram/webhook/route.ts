import { NextResponse } from "next/server";

import { receiveTelegram } from "@/modules/ai/bot/incoming";

export const dynamic = "force-dynamic";

/** Telegram's updates are small; anything bigger is not Telegram. */
const MAX_BODY = 256 * 1024;

/**
 * POST /api/bot/telegram/webhook — Telegram's calls for the bots connected in
 * AI Center > Bot. Each carries the secret token the ERP gave Telegram; a call
 * without one of ours is refused. The message is kept and answered in the
 * background, so Telegram gets its answer at once.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || secret.length > 256) return new NextResponse(null, { status: 401 });
  const text = await request.text();
  if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  try {
    const result = await receiveTelegram(secret, body);
    if (result === "unknown") return new NextResponse(null, { status: 401 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[bot] telegram webhook failed", error);
    return new NextResponse(null, { status: 500 });
  }
}
