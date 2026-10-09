import { PackagePlusIcon, PlusIcon, SendIcon, TruckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Stat } from "@/components/accounts/stat";
import { SectionError } from "@/components/dashboard/section-error";
import { IssueKindBadge } from "@/components/materials/badges";
import { KIND_LABELS, materialsHref, quantity } from "@/components/materials/labels";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/display";
import { getMaterialsOverviewScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Raw materials" };

const rowLink =
  "flex items-start justify-between gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25";
const linkClass = "text-sm text-primary underline-offset-4 hover:underline";

/**
 * The Raw materials Overview (materials.view): how many materials the store
 * keeps and how many it holds, what is running low, purchase orders running
 * late, what each store holds and the latest issue notes. Stock values show
 * only to people who see material prices.
 */
export default async function MaterialsOverviewPage() {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.view")) return <MaterialsNoAccess />;
  const result = await getMaterialsOverviewScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return (
      <SectionError
        title="Raw materials"
        heading="The overview could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const { totals, byKind, lowStock, stores, orders, recentNotes, seeCosts, can } = screen;
  const currency = ctx.company.currency;
  const count = (n: number) => formatCount(n, currency);
  const openOrders = orders.open + orders.partiallyReceived;

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl text-primary">Overview</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Fabric, trims and packaging in the store: what is running low, what is on its way and
            what went to production.
          </p>
        </div>
        {(can.receive || can.order || can.issue || can.addMaterial) && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {can.receive && (
              <Button asChild className="w-full sm:w-auto">
                <Link href={materialsHref.newPurchase()}>
                  <TruckIcon aria-hidden />
                  Receive goods
                </Link>
              </Button>
            )}
            {can.order && (
              <Button
                asChild
                variant={can.receive ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                <Link href={materialsHref.newOrder()}>
                  <PlusIcon aria-hidden />
                  New purchase order
                </Link>
              </Button>
            )}
            {can.issue && (
              <Button
                asChild
                variant={can.receive || can.order ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                <Link href={materialsHref.newIssue("issue")}>
                  <SendIcon aria-hidden />
                  Issue to production
                </Link>
              </Button>
            )}
            {can.addMaterial && !can.order && (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href={materialsHref.newMaterial}>
                  <PackagePlusIcon aria-hidden />
                  Add a material
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      <section aria-label="The store at a glance">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Materials"
            value={count(totals.materials)}
            hint={`${count(totals.inStock)} in stock`}
            href={materialsHref.stock}
          />
          <Stat
            label="Running low"
            value={count(lowStock.length)}
            hint="At or below the reorder level"
            href={`${materialsHref.stock}?low=1`}
            alert={lowStock.length > 0}
          />
          <Stat
            label="Open orders"
            value={count(openOrders)}
            hint={
              orders.partiallyReceived > 0
                ? `${count(orders.partiallyReceived)} part received`
                : "Waiting for the goods"
            }
            href={materialsHref.orders}
          />
          <Stat
            label="Late orders"
            value={count(orders.overdue.length)}
            hint="Past the expected day"
            href={`${materialsHref.orders}?overdue=1`}
            alert={orders.overdue.length > 0}
          />
          {seeCosts && totals.value && (
            <Stat
              label="Stock value"
              value={money(totals.value, currency)}
              hint="At average cost"
              className="col-span-2 sm:col-span-1"
            />
          )}
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Running low"
            id="low-heading"
            action={
              lowStock.length > 0 ? (
                <Link href={`${materialsHref.stock}?low=1`} className={linkClass}>
                  See all
                </Link>
              ) : undefined
            }
          >
            {lowStock.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing is at or below its reorder level.
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Materials running low">
                {lowStock.slice(0, 8).map((m) => (
                  <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                    <Link href={materialsHref.material(m.id)} className={rowLink}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-primary">{m.code}</span>
                        <span className="block truncate text-[0.8125rem] text-muted-foreground">
                          {m.name}
                        </span>
                      </span>
                      <span className="text-right text-sm whitespace-nowrap tabular-nums">
                        <span className="block font-medium text-destructive">
                          {quantity(m.quantity, m.unit, currency)}
                        </span>
                        <span className="block text-[0.8125rem] text-muted-foreground">
                          {/[1-9]/.test(m.incoming)
                            ? `${quantity(m.incoming, m.unit, currency)} on order`
                            : m.reorderLevel
                              ? `Reorder at ${quantity(m.reorderLevel, m.unit, currency)}`
                              : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Late orders"
            id="late-heading"
            action={
              orders.overdue.length > 0 ? (
                <Link href={`${materialsHref.orders}?overdue=1`} className={linkClass}>
                  See all
                </Link>
              ) : undefined
            }
          >
            {orders.overdue.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {openOrders > 0
                  ? "Every open order is still within its expected day."
                  : "No purchase orders are open."}
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Late purchase orders">
                {orders.overdue.slice(0, 8).map((o) => (
                  <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                    <Link href={materialsHref.order(o.id)} className={rowLink}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-primary">
                          {o.number}
                          {o.project ? ` · ${o.project.code}` : ""}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-muted-foreground">
                          {o.supplier?.name}
                        </span>
                      </span>
                      <span className="text-right text-sm whitespace-nowrap">
                        <span className="block font-medium text-destructive">
                          {o.daysLate} {o.daysLate === 1 ? "day" : "days"} late
                        </span>
                        {o.expectedOn && (
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            Due {formatDay(o.expectedOn)}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="By kind" id="kinds-heading">
            {byKind.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No materials yet.{" "}
                {can.addMaterial && (
                  <Link href={materialsHref.newMaterial} className={linkClass}>
                    Add the first one
                  </Link>
                )}
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Materials by kind">
                {byKind.map((k) => (
                  <li key={k.kind} className="py-3 first:pt-0 last:pb-0">
                    <Link href={`${materialsHref.stock}?kind=${k.kind}`} className={rowLink}>
                      <span className="min-w-0 text-sm">
                        <span className="block font-medium">{KIND_LABELS[k.kind]}</span>
                        <span className="block text-[0.8125rem] text-muted-foreground">
                          {count(k.inStock)} of {count(k.materials)} in stock
                        </span>
                      </span>
                      {seeCosts && k.value && (
                        <span className="text-sm whitespace-nowrap tabular-nums">
                          {money(k.value, currency)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {stores.length > 0 && (
            <Panel title="Stores" id="stores-heading">
              <ul className="mt-4 grid divide-y" aria-label="Stores">
                {stores.map((s) => (
                  <li key={s.warehouse.id} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      href={`${materialsHref.stock}?store=${s.warehouse.id}`}
                      className={rowLink}
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        {s.warehouse.name}
                      </span>
                      <span className="text-sm whitespace-nowrap text-muted-foreground">
                        {count(s.materials)} {s.materials === 1 ? "material" : "materials"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            title="Latest issue notes"
            id="notes-heading"
            action={
              recentNotes.length > 0 ? (
                <Link href={materialsHref.issues} className={linkClass}>
                  See all
                </Link>
              ) : undefined
            }
          >
            {recentNotes.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing has gone to production yet.
              </p>
            ) : (
              <ul className="mt-4 grid divide-y" aria-label="Latest issue notes">
                {recentNotes.map((n) => (
                  <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                    <Link href={materialsHref.issue(n.id)} className={rowLink}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-primary">
                          {n.number} · {n.project.code}
                        </span>
                        <span className="block truncate text-[0.8125rem] text-muted-foreground">
                          {formatDay(n.day)} · {n.lineCount}{" "}
                          {n.lineCount === 1 ? "material" : "materials"}
                        </span>
                      </span>
                      <IssueKindBadge kind={n.kind} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
