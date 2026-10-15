import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AiNoAccess } from "@/components/ai/no-access";
import { OrderRunScreen } from "@/components/ai/order-run-screen";
import { SectionError } from "@/components/dashboard/section-error";
import { getOrderRunAction } from "@/server/actions/orders.actions";

export const metadata: Metadata = { title: "AI Order" };

/** One order given to Mehedi 2.0 (ai.view or ai.manage; changes need ai.manage). */
export default async function AiOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOrderRunAction(id);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    if (result.error.code === "NOT_FOUND") notFound();
    return <SectionError title="Order" heading="The order could not load" error={result.error} />;
  }
  return <OrderRunScreen run={result.data} />;
}
