import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProjectForm } from "@/components/production/project-form";
import { StartFromSale } from "@/components/production/start-from-sale";
import { BackLink } from "@/components/settings/back-link";
import { salesHref } from "@/components/sales/labels";
import { getProjectFormAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "New production project" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

/**
 * A new production project: for production.manage, the permission createProjectAction
 * checks. "Start production" on a sales order (?order=) or a proforma (?proforma=)
 * opens it filled in from that one; without one, a search finds an open order or
 * proforma to start from (Production Managers do not open Sales). "Order now" on the
 * Home screen's low stock (?restock=) starts an in-house project for the style.
 */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Starting projects is not part of your role">
        Production Managers start projects. Your administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const query = await searchParams;
  const from = {
    orderId: one(query.order),
    proformaId: one(query.order) ? undefined : one(query.proforma),
    restockStyleId: one(query.order) || one(query.proforma) ? undefined : one(query.restock),
  };
  const result = await getProjectFormAction(undefined, from);
  // Production Managers start from a sale without opening Sales: back to the projects.
  const openSales = ctx.can("sales.view");
  const back =
    from.orderId && openSales
      ? { href: salesHref.order(from.orderId), label: "Back to the order" }
      : from.proformaId && openSales
        ? { href: salesHref.proforma(from.proformaId), label: "Back to the proforma" }
        : from.restockStyleId
          ? { href: "/", label: "Back to the Home screen" }
          : { href: "/production/projects", label: "All projects" };
  if (!result.ok) {
    return (
      <div className="grid gap-6">
        <BackLink href={back.href}>{back.label}</BackLink>
        <SectionError
          title="New project"
          heading={
            from.orderId || from.proformaId
              ? "Production cannot start from it"
              : from.restockStyleId
                ? "The style could not load"
                : "The form could not load"
          }
          error={result.error}
        />
      </div>
    );
  }
  const source = result.data.source;
  const restock = result.data.restock;

  return (
    <div className="grid gap-6">
      <BackLink href={back.href}>{back.label}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">
          {source
            ? `Start production for ${source.number}`
            : restock
              ? `Restock ${restock.style.code}`
              : "New project"}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {source
            ? `Filled in from ${source.kind === "ORDER" ? "the order" : "the proforma"} for ${source.buyer.name}. Check the pieces per colour and size, choose the factory and create it.`
            : restock
              ? `${restock.style.name}, made In-House for our own stock. Fill in the pieces to make of each colour and size, choose the factory and create it.`
              : "A batch to make in a factory. Its costs and deliveries are added once it is created."}
        </p>
      </div>
      {!source && !restock && <StartFromSale currency={ctx.company.currency} />}
      {/* Keyed by the sale, so picking one in the search starts the form afresh. */}
      <ProjectForm
        key={
          source ? `${source.kind}-${source.id}` : restock ? `restock-${restock.style.id}` : "new"
        }
        form={result.data}
        currency={ctx.company.currency}
      />
    </div>
  );
}
