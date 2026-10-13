import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { CmSettlementView } from "@/components/production/cm-settlement";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { getCmSettlementScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Final CM settlement" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * A master batch's final CM settlement with its factory (production.manage or accounts.view;
 * like GET /api/production/batches/:id/cm-settlement): Total CM - Deductions - Advance taken =
 * Final payable, saved with its PDF bill.
 */
export default async function CmSettlementPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ batchId }, query] = await Promise.all([params, searchParams]);
  const result = await getCmSettlementScreenAction(batchId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="The CM settlement is not part of your role">
          Production Managers and Accounts work out the factory&apos;s CM. Your administrator can
          give your role that permission.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="CM settlement"
        heading="The CM settlement could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const { batch, factory } = screen;
  const factoryName = factory?.name ?? "the factory";
  const notice = one(query.settled)
    ? `${one(query.settled)} was saved. ${
        screen.standing?.posted
          ? `Its deductions came off ${factoryName}'s Supplier Due, and Accounts was told the final payable.`
          : "Accounts was told the final payable."
      } Download the PDF bill for ${factoryName}.`
    : one(query.undone)
      ? `${one(query.undone)} was undone. Its faults are open again${
          screen.undone.find((u) => u.number === one(query.undone))?.posted
            ? `, and its deductions are back on ${factoryName}'s Supplier Due`
            : ""
        }.`
      : undefined;
  return (
    <div className="grid gap-6">
      <BackLink href={productionHref.batch(batch.id)}>
        {batch.code} · {batch.name}
      </BackLink>
      <div>
        <p className="eyebrow">{batch.code}</p>
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Final CM settlement</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {factory ? `With ${factory.name}. ` : ""}Total CM - Deductions - Advance taken = Final
          payable.
        </p>
      </div>
      <CmSettlementView screen={screen} currency={ctx.company.currency} notice={notice} />
    </div>
  );
}
