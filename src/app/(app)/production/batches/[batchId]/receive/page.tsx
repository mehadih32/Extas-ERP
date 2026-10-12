import { PackageCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { BatchReceiveForm } from "@/components/production/batch-receive-form";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { getBatchReceiveAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Receive for the batch" };

/**
 * The batch's central receive (materials.purchase, as receiveBatchDeliveryAction): the
 * batch's orders with goods still to come, and for the order chosen, Challan vs Actual
 * on each line still to come.
 */
export default async function BatchReceivePage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.purchase")) {
    return (
      <ProductionNoAccess title="Receiving materials is not part of your role">
        Buyers take deliveries into the store as supplier bills (materials.purchase). Your
        administrator can give your role that permission.
      </ProductionNoAccess>
    );
  }
  const [{ batchId }, query] = await Promise.all([params, searchParams]);
  const asked = typeof query.order === "string" ? query.order : undefined;
  let result = await getBatchReceiveAction(batchId, asked);
  // With one order to receive on, it is chosen.
  if (result.ok && !asked && result.data.orders.length === 1) {
    result = await getBatchReceiveAction(batchId, result.data.orders[0]!.id);
  }
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" && !asked) notFound();
    return (
      <SectionError
        title="Receive"
        heading="The batch's orders could not load"
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
        <h2 className="mt-2 font-serif text-2xl break-words text-primary">Receive for the batch</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          One central receive for every style in the batch: the store weighs or counts what came
          against the supplier&apos;s challan, and only what actually came is billed.
        </p>
      </div>
      {data.orders.length === 0 ? (
        <EmptyState title="Nothing to receive">
          None of {b.code}&apos;s purchase orders has goods still to come.
        </EmptyState>
      ) : (
        <nav aria-label="Orders to receive on" className="max-w-3xl">
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.orders.map((o) => {
              const chosen = data.order?.id === o.id;
              return (
                <li key={o.id}>
                  <Link
                    href={productionHref.receive(b.id, o.id)}
                    aria-current={chosen ? "page" : undefined}
                    className={cn(
                      "grid gap-0.5 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/40",
                      chosen && "border-primary ring-1 ring-primary",
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium break-words">
                      <PackageCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                      {o.supplier.name}
                    </span>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      {o.number} · {o.toCome} of {o.lines} {o.lines === 1 ? "line" : "lines"} to
                      come
                      {o.expectedOn ? ` · by ${formatDay(o.expectedOn)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {data.order ? (
        <>
          <div className="max-w-3xl border-t pt-6">
            <h3 className="font-serif text-xl break-words text-primary">
              {data.order.supplier.name}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{data.order.number}</p>
          </div>
          <BatchReceiveForm key={data.order.id} data={data} currency={ctx.company.currency} />
        </>
      ) : (
        data.orders.length > 1 && (
          <p className="text-sm text-muted-foreground">Choose the order the goods came on.</p>
        )
      )}
    </div>
  );
}
