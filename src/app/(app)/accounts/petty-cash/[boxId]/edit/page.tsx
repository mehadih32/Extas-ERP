import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { pettyCashHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { PettyCashForm } from "@/components/accounts/petty-cash-form";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getPettyCashFormAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change petty cash box" };

/** Renaming a petty cash box, handing it to someone else or changing its usual amount (accounts.manage). */
export default async function EditPettyCashBoxPage({
  params,
}: {
  params: Promise<{ boxId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { boxId } = await params;
  const result = await getPettyCashFormAction(boxId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Petty cash boxes are set up by Accounts">
          Only Accounts and the owner change petty cash boxes.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="Change petty cash box"
        heading="The box could not load"
        error={result.error}
      />
    );
  }
  const box = result.data.box!;

  return (
    <div className="grid gap-6">
      <BackLink href={pettyCashHref.box(box.id)}>{box.name}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change {box.name}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          A new holder takes over the cash that is in the box now. Top-ups and costs already
          recorded stay as they are.
        </p>
      </div>
      <PettyCashForm data={result.data} currency={ctx.company.currency} />
    </div>
  );
}
