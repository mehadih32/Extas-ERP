import { FollowUpPanel } from "@/components/follow-ups/follow-up-panel";
import { PromisePanel } from "@/components/follow-ups/promise-panel";
import { TodaysFollowUpsCard } from "@/components/follow-ups/todays-follow-ups";
import {
  invoicePromiseAction,
  listFollowUpsAction,
  todaysFollowUpsAction,
} from "@/server/actions/reminders.actions";

/** The "Follow-ups" panel of a buyer, a quotation or an order (nothing when it cannot be read). */
export async function FollowUpSection({
  on,
  what,
}: {
  on: { partyId: string } | { quotationId: string } | { orderId: string };
  what: string;
}) {
  const result = await listFollowUpsAction(on);
  if (!result.ok) return null;
  return <FollowUpPanel on={on} items={result.data.items} today={result.data.today} what={what} />;
}

/** An invoice's "Promised payment" panel: while money is due, or when a promise is kept on it. */
export async function PromiseSection({ invoiceId }: { invoiceId: string }) {
  const result = await invoicePromiseAction(invoiceId);
  if (!result.ok) return null;
  const promise = result.data;
  if (!promise.open && !promise.on) return null;
  return (
    <PromisePanel
      invoiceId={invoiceId}
      promise={{ on: promise.on, note: promise.note }}
      today={promise.today}
      canEdit={promise.canEdit && promise.open}
    />
  );
}

/** Home's "Today's follow-ups" (nothing when none is due or it cannot be read). */
export async function TodaysFollowUpsSection() {
  const result = await todaysFollowUpsAction();
  if (!result.ok) return null;
  return <TodaysFollowUpsCard data={result.data} />;
}
