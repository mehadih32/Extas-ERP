import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { materialsHref } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { ReturnForm } from "@/components/materials/return-form";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { getReturnFormAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Send goods back" };

const idParam = (value: string | string[] | undefined) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : undefined;

/**
 * Sending goods back to the supplier from a purchase (?bill=): for buyers
 * (materials.purchase) and Accounts (accounts.manage), the permissions
 * createSupplierReturnAction checks.
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.purchase") && !ctx.can("accounts.manage")) {
    return (
      <MaterialsNoAccess title="Returning goods is not part of your role">
        Buyers, Production Managers and Accounts send goods back to suppliers.
      </MaterialsNoAccess>
    );
  }
  const billId = idParam((await searchParams).bill);
  if (!billId) {
    return (
      <div className="grid gap-6">
        <BackLink href={materialsHref.purchases}>All purchases</BackLink>
        <FormAlert tone="note">
          Goods go back from the purchase they came on. Open that purchase and choose Send goods
          back.
        </FormAlert>
      </div>
    );
  }
  const result = await getReturnFormAction(billId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "CONFLICT") {
      return (
        <div className="grid gap-6">
          <BackLink href={materialsHref.purchase(billId)}>The purchase</BackLink>
          <FormAlert tone="note">{result.error.message}</FormAlert>
        </div>
      );
    }
    return (
      <SectionError
        title="Send goods back"
        heading="The form could not load"
        error={result.error}
      />
    );
  }
  const bill = result.data.bill;

  return (
    <div className="grid gap-6">
      <BackLink href={materialsHref.purchase(bill.id)}>{bill.number}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">
          Send goods back to {bill.supplier.name}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          From {bill.number} of {formatDay(bill.billOn)}
          {bill.supplierRef ? ` (their no. ${bill.supplierRef})` : ""}. A debit note is made and
          their account is credited.
        </p>
      </div>
      <ReturnForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
