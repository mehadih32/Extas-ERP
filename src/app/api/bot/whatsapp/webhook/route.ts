import { NextResponse } from "next/server";

import { receiveWhatsApp, verifyWhatsApp } from "@/modules/ai/bot/incoming";

export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024;

/**
 * GET /api/bot/whatsapp/webhook — Meta's check when the owner adds the webhook
 * in the Meta app: the challenge comes back only for a verify token shown in
 * AI Center > Bot.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (url.searchParams.get("hub.mode") !== "subscribe" || !token || token.length > 256) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await verifyWhatsApp(token))) return new NextResponse(null, { status: 403 });
  return new NextResponse(challenge.slice(0, 200), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * POST /api/bot/whatsapp/webhook — Meta's calls for the WhatsApp number in
 * AI Center > Bot, each signed with the app's secret (X-Hub-Signature-256).
 */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return new NextResponse(null, { status: 413 });
  try {
    const result = await receiveWhatsApp(text, request.headers.get("x-hub-signature-256"));
    if (result === "bad-signature") return new NextResponse(null, { status: 401 });
    // A number that is not connected here: Meta is told all is well and nothing happens.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[bot] whatsapp webhook failed", error);
    return new NextResponse(null, { status: 500 });
  }
}
