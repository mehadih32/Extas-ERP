import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { materialsHref } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { OrderForm } from "@/components/materials/order-form";
import { BackLink } from "@/components/settings/back-link";
import { getOrderFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New purchase order" };

const idParam = (value: string | string[] | undefined) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined;

/**
 * A new purchase order: for buyers (materials.purchase), started from a
 * material, a supplier or a production project when the link names one.
 */
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.purchase")) {
    return (
      <MaterialsNoAccess title="Ordering materials is not part of your role">
        Production Managers and buyers raise purchase orders.
      </MaterialsNoAccess>
    );
  }
  const query = await searchParams;
  const result = await getOrderFormAction({
    materialId: idParam(query.material),
    supplierId: idParam(query.supplier),
    projectId: idParam(query.project),
  });
  if (!result.ok) {
    return (
      <SectionError title="New order" heading="The form could not load" error={result.error} />
    );
  }
  const from = result.data.lines[0]?.material;

  return (
    <div className="grid gap-6">
      <BackLink href={from ? materialsHref.material(from.id) : materialsHref.orders}>
        {from ? from.code : "All orders"}
      </BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New purchase order</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          What to send and at what price. Nothing reaches the stock or the books until the goods are
          received against it.
        </p>
      </div>
      <OrderForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
