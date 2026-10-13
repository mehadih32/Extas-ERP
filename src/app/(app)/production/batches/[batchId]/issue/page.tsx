import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { BatchIssueForm } from "@/components/production/batch-issue-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getBatchIssueAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Issue to styles" };

/**
 * Issuing the batch's materials to its styles colour by colour (materials.manage, as
 * issueToStylesAction): one issue note per style, each charged only for what it took.
 */
export default async function BatchIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.manage")) {
    return (
      <ProductionNoAccess title="Issuing materials is not part of your role">
        The store issues materials to production (materials.manage). Your administrator can give
        your role that permission.
      </ProductionNoAccess>
    );
  }
  const [{ batchId }, query] = await Promise.all([params, searchParams]);
  const result = await getBatchIssueAction(
    batchId,
    typeof query.store === "string" ? query.store : undefined,
  );
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError
        title="Issue"
        heading="The batch's materials could not load"
        error={result.error}
      />
    );
  }
  const data = result.data;
  const b = data.batch;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.batch(b.id)}>
        {b.code} · {b.name}
      </BackLink>
      <div>
        <p className="eyebrow">{b.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Issue to styles</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Hand the batch&apos;s fabric and accessories to each style, colour by colour. Each style
          gets its own issue note and is charged only for what it took, at the store&apos;s average
          cost.
        </p>
      </div>
      {data.materials.length === 0 ? (
        <EmptyState title="Nothing to issue">
          {data.styles.length === 0
            ? `${b.code} has no open style.`
            : "Give the styles their materials per piece first; what they need shows here to issue."}
        </EmptyState>
      ) : (
        <BatchIssueForm key={data.storeId} data={data} currency={ctx.company.currency} />
      )}
    </div>
  );
}
