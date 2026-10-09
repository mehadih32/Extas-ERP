import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { OrderForm } from "@/components/sales/order-form";
import { BackLink } from "@/components/settings/back-link";
import { getOrderFormAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New order" };

/**
 * A new order, or (?proforma=) the order a proforma becomes once its advance is
 * paid: for sales.order.create, the permission createOrderAction and
 * convertProformaToOrderAction check.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const query = await searchParams;
  const proformaId = typeof query.proforma === "string" ? query.proforma : undefined;
  const result = await getOrderFormAction({ proformaId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT" && proformaId) redirect(salesHref.proforma(proformaId));
    if (result.error.code === "FORBIDDEN") {
      return (
        <SalesNoAccess title="Taking orders is not part of your role">
          Your administrator can give your role the permission to create orders.
        </SalesNoAccess>
      );
    }
    return (
      <SectionError title="New order" heading="The form could not load" error={result.error} />
    );
  }
  const proforma = result.data.proforma;

  return (
    <div className="grid gap-6">
      {proforma ? (
        <BackLink href={salesHref.proforma(proforma.id)}>{proforma.number}</BackLink>
      ) : (
        <BackLink href="/sales/orders">All orders</BackLink>
      )}
      <div>
        {proforma && <p className="eyebrow">{proforma.number}</p>}
        <h2
          className={
            proforma ? "mt-2 font-serif text-2xl text-primary" : "font-serif text-2xl text-primary"
          }
        >
          {proforma ? "Make the order" : "New order"}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {proforma
            ? `The goods for ${proforma.buyer.name} are ready: enter what is shipping. The advance paid on the proforma counts towards the order.`
            : "The pieces are held for the order as soon as it is placed."}
        </p>
      </div>
      <OrderForm form={result.data} />
    </div>
  );
}
