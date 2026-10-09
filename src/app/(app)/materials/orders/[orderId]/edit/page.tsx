import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { materialsHref } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { OrderForm } from "@/components/materials/order-form";
import { BackLink } from "@/components/settings/back-link";
import { getOrderFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change a purchase order" };

/**
 * A purchase order's details (buyers, materials.purchase) while it is open:
 * its lines only while nothing has arrived on it.
 */
export default async function EditOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await requireCompanyPage();
  const { orderId } = await params;
  if (!ctx.can("materials.purchase")) {
    return (
      <MaterialsNoAccess title="Changing orders is not part of your role">
        Production Managers and buyers keep the purchase orders.
      </MaterialsNoAccess>
    );
  }
  const result = await getOrderFormAction({ orderId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT" || result.error.code === "VALIDATION") {
      return (
        <div className="grid gap-6">
          <BackLink href={materialsHref.order(orderId)}>The order</BackLink>
          <FormAlert tone="note">{result.error.message}</FormAlert>
        </div>
      );
    }
    return <SectionError title="Order" heading="The order could not load" error={result.error} />;
  }
  const order = result.data.order!;

  return (
    <div className="grid gap-6">
      <BackLink href={materialsHref.order(order.id)}>{order.number}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change {order.number}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Tell the supplier about any change you make here.
        </p>
      </div>
      <OrderForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
