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
    const events = await scanShopChanges(now);
    // Retail stores' daily summaries: ask for missing days, tell the owner (plan v6 sec 6).
    const { summaryGuards } = await import("@/modules/retail/summaries.service");
    await summaryGuards(now).catch((error) =>
      console.error("[retail] summary guard failed", error),
    );
    // Retail sites: lines filled again, payments recorded, holds (site-changes 2.8).
    const { fillWaitingLines } = await import("./orders.service");
    await fillWaitingLines().catch((error) => console.error("[retail] line fill failed", error));
    const { retailSiteWatch } = await import("@/modules/retail/site-watch");
    await retailSiteWatch(now).catch((error) =>
      console.error("[retail] site notices failed", error),
    );
    // The night summary of the stores, its alerts and the Saturday advice (plan v6 sec 13).
    const { retailWatch } = await import("@/modules/retail/watch.service");
    await retailWatch(now).catch((error) => console.error("[retail] night watch failed", error));
    return events;
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
