import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { BatchForm } from "@/components/production/batch-form";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBatchFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New master batch" };

/** A new master batch: for production.manage, the permission createBatchAction checks. */
export default async function NewBatchPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Starting batches is not part of your role">
        Production Managers start batches. Your administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const result = await getBatchFormAction();
  if (!result.ok) {
    return (
      <SectionError title="New batch" heading="The form could not load" error={result.error} />
    );
  }
  return (
    <div className="grid gap-6">
      <BackLink href="/production/batches">All batches</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New master batch</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          One umbrella for the styles made together. Create it, then add each style with its colours
          and sizes and its target price.
        </p>
      </div>
      <BatchForm form={result.data} />
    </div>
  );
}
