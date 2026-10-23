import { scanShopChanges } from "./webhooks";

/*
 * The online shops' webhook clock (CN-005). Started once per server process
 * (instrumentation.ts) unless ECOMMERCE_WEBHOOKS=off; every minute it finds
 * what changed for each shop and queues the webhooks (webhooks.ts), which the
 * background worker sends. A pass still going when the next minute comes is
 * not doubled. Never on a restore drill copy or a copy on standby: those must
 * not send anything to a shop.
 */

const CHECK_EVERY_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export async function ecommerceWebhookTick(now: Date = new Date()) {
  if (running) return null;
  running = true;
  try {
    const { onDrill, onStandby } = await import("@/modules/backups/standby");
    if ((await onDrill()) || (await onStandby())) return null;
    return await scanShopChanges(now);
  } catch (error) {
    console.error("[ecommerce] webhook pass failed", error);
    return null;
  } finally {
    running = false;
  }
}

export function startEcommerceWebhooks() {
  if (timer) return;
  timer = setInterval(() => void ecommerceWebhookTick(), CHECK_EVERY_MS);
  timer.unref();
  console.log("[ecommerce] online shop webhooks started");
}

export function stopEcommerceWebhooks() {
  if (timer) clearInterval(timer);
  timer = null;
}
