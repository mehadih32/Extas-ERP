import { ordersForStaffAction } from "@/server/actions/orders.actions";

import { TellAiButton } from "./tell-ai";

/** The Tell AI button, shown only while the AI is switched on and to staff who may use it. */
export async function TellAiSlot({ className }: { className?: string }) {
  const result = await ordersForStaffAction();
  if (!result.ok || !result.data.on) return null;
  return <TellAiButton orders={result.data.orders} className={className} />;
}
