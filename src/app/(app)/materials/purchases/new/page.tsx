import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { materialsHref } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { PurchaseForm } from "@/components/materials/purchase-form";
import { BackLink } from "@/components/settings/back-link";
import { getPurchaseFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Receive goods" };

const idParam = (value: string | string[] | undefined) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined;

/**
 * Receiving raw materials with the supplier's bill: for buyers
 * (materials.purchase) and Accounts (accounts.payments.record, who may also pay
 * it now), the permissions createPurchaseAction checks. ?order= receives
 * against a purchase order.
 */
export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.purchase") && !ctx.can("accounts.payments.record")) {
    return (
      <MaterialsNoAccess title="Receiving goods is not part of your role">
        Buyers, Production Managers and Accounts enter the supplier&apos;s bill when goods come in.
      </MaterialsNoAccess>
    );
  }
  const orderId = idParam((await searchParams).order);
  const result = await getPurchaseFormAction({ orderId });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT") {
      return (
        <div className="grid gap-6">
          <BackLink href={orderId ? materialsHref.order(orderId) : materialsHref.purchases}>
            {orderId ? "The order" : "All purchases"}
          </BackLink>
          <FormAlert tone="note">{result.error.message}</FormAlert>
        </div>
      );
    }
    return (
      <SectionError title="Receive goods" heading="The form could not load" error={result.error} />
    );
  }
  const order = result.data.order;

  return (
    <div className="grid gap-6">
      <BackLink href={order ? materialsHref.order(order.id) : materialsHref.purchases}>
        {order ? order.number : "All purchases"}
      </BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">
          {order ? `Receive goods on ${order.number}` : "Receive goods"}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Enter the supplier&apos;s bill as it came with the goods. They go into the store at its
          prices, and the bill goes on the supplier&apos;s account.
        </p>
      </div>
      <PurchaseForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
