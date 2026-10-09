import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { OrderForm } from "@/components/sales/order-form";
import { BackLink } from "@/components/settings/back-link";
import { getOrderFormAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Edit order" };

/**
 * An order's lines and charges, before anything leaves the warehouse and while
 * it has no live invoice: for sales.order.create, the permission
 * updateOrderAction checks. One that can no longer change goes back to its page.
 */
export default async function EditOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  await requireCompanyPage();
  const { orderId } = await params;
  const result = await getOrderFormAction({ orderId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT") redirect(salesHref.order(orderId));
    if (result.error.code === "FORBIDDEN") {
      return (
        <SalesNoAccess title="Changing orders is not part of your role">
          Your administrator can give your role the permission to create orders.
        </SalesNoAccess>
      );
    }
    return (
      <SectionError title="Edit order" heading="The form could not load" error={result.error} />
    );
  }
  const order = result.data.order!;

  return (
    <div className="grid gap-6">
      <BackLink href={salesHref.order(order.id)}>{order.number}</BackLink>
      <div>
        <p className="eyebrow">{order.number}</p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Edit order</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          The pieces held for it are redone when it is saved.
        </p>
      </div>
      <OrderForm form={result.data} />
    </div>
  );
}
