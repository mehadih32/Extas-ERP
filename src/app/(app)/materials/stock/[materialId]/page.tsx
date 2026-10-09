import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FlagBadge, OrderBadge } from "@/components/materials/badges";
import { CardFilters } from "@/components/materials/card-filters";
import { KIND_LABELS, materialsHref, perUnit, quantity } from "@/components/materials/labels";
import { MaterialActions } from "@/components/materials/material-actions";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { StockCard } from "@/components/materials/stock-card";
import { dayParam } from "@/components/parties/route";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { BackLink } from "@/components/settings/back-link";
import { formatDay, formatDayRange } from "@/lib/display";
import { getMaterialScreenAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Material" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/** The days a stock card covers, either end left open. */
function periodText(from: string | null, to: string | null): string {
  if (from && to) return formatDayRange(from, to);
  if (from) return `From ${formatDay(from)}`;
  if (to) return `Up to ${formatDay(to)}`;
  return "Everything so far";
}

/**
 * One raw material (materials.view, like GET /api/materials/:id and its stock
 * card): what each store holds, what is on order, its details, and its stock
 * card for the days and store chosen. Costs and values show to people who see
 * material prices.
 */
export default async function MaterialPage({
  params,
  searchParams,
}: {
  params: Promise<{ materialId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ materialId }, query] = await Promise.all([params, searchParams]);
  const from = dayParam(query.from);
  const to = dayParam(query.to);
  const store = /^[A-Za-z0-9_-]{1,40}$/.test(one(query.store) ?? "") ? one(query.store) : undefined;
  const result = await getMaterialScreenAction(materialId, { from, to, store });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return (
      <SectionError title="Material" heading="The material could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { material: m, card, seeCosts, can, notes } = screen;
  const currency = ctx.company.currency;
  const q = (text: string) => quantity(text, m.unit, currency);
  const notice =
    one(query.created) === "1"
      ? `${m.code} was added.`
      : one(query.saved) === "1"
        ? `${m.code} was saved.`
        : undefined;
  const onOrder = /[1-9]/.test(m.incoming);

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={materialsHref.stock}>All materials</BackLink>
        <RecordHeader
          eyebrow={`${m.code} · ${KIND_LABELS[m.kind]}`}
          title={m.name}
          badges={
            <>
              {!m.isActive && <FlagBadge tone="closed">Archived</FlagBadge>}
              {m.isActive && m.isLow && <FlagBadge>Running low</FlagBadge>}
              {m.color && <span className="text-sm text-muted-foreground">{m.color}</span>}
            </>
          }
        />
        <MaterialActions key={m.id} screen={screen} currency={currency} notice={notice} />
      </div>

      <section aria-label="Stock now">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "On hand", value: q(m.quantity), alert: m.isLow },
            { label: "On order", value: onOrder ? q(m.incoming) : "Nothing" },
            ...(seeCosts
              ? [
                  {
                    label: "Average cost",
                    value: m.avgCost ? perUnit(m.avgCost, m.unit, currency) : "–",
                  },
                  { label: "Value", value: m.stockValue ? money(m.stockValue, currency) : "–" },
                ]
              : [
                  {
                    label: "Running low at",
                    value: m.reorderLevel ? q(m.reorderLevel) : "Not set",
                  },
                ]),
          ].map((f) => (
            <div key={f.label} className="min-w-0 rounded-lg border bg-card p-4">
              <dt className="eyebrow">{f.label}</dt>
              <dd
                className={`mt-1 font-serif text-xl leading-tight break-words tabular-nums ${
                  "alert" in f && f.alert ? "text-destructive" : "text-primary"
                }`}
              >
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="In each store" id="stores-heading">
          {m.stores.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No store holds any yet.</p>
          ) : (
            <ul className="mt-4 grid divide-y">
              {m.stores.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-sm">{s.name}</span>
                  <span className="text-sm font-medium whitespace-nowrap tabular-nums">
                    {q(s.quantity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="On order"
          id="orders-heading"
          action={
            m.orders.length > 0 ? (
              <Link
                href={`${materialsHref.orders}?material=${encodeURIComponent(m.id)}`}
                className={`text-sm ${linkClass}`}
              >
                All orders
              </Link>
            ) : undefined
          }
        >
          {m.orders.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No open purchase order has it.</p>
          ) : (
            <ul className="mt-4 grid divide-y">
              {m.orders.map((o) => (
                <li key={o.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={materialsHref.order(o.id)}
                      className={`text-sm font-medium ${linkClass}`}
                    >
                      {o.number}
                    </Link>
                    <OrderBadge status={o.status} />
                  </div>
                  <p className="text-[0.8125rem] break-words text-muted-foreground">
                    {o.supplier?.name}
                    {o.expectedOn ? ` · expected ${formatDay(o.expectedOn)}` : ""}
                  </p>
                  <p className="text-sm tabular-nums">
                    {q(o.pending)} to come
                    {o.received !== "0" ? (
                      <span className="text-muted-foreground"> of {q(o.ordered)}</span>
                    ) : null}
                    {seeCosts && o.unitPrice ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {perUnit(o.unitPrice, m.unit, currency)}
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Details" id="details-heading">
          <dl className="mt-4 grid gap-4">
            {m.specification && <Fact label="Specification">{m.specification}</Fact>}
            <Fact label="Usual supplier">
              {m.supplier ? (
                can.openParty ? (
                  <Link href={materialsHref.supplier(m.supplier.id)} className={linkClass}>
                    {m.supplier.name}
                  </Link>
                ) : (
                  m.supplier.name
                )
              ) : (
                "Not set"
              )}
            </Fact>
            {seeCosts && (
              <Fact label="Running low at">{m.reorderLevel ? q(m.reorderLevel) : "Not set"}</Fact>
            )}
            {m.notes && (
              <Fact label="Notes">
                <span className="whitespace-pre-line">{m.notes}</span>
              </Fact>
            )}
            {notes.archive && (
              <Fact label="Archiving">
                <span className="text-muted-foreground">{notes.archive}</span>
              </Fact>
            )}
          </dl>
        </Panel>
      </div>

      <section aria-labelledby="card-heading" className="grid min-w-0 gap-4">
        <div>
          <h3 id="card-heading" className="font-serif text-2xl text-primary">
            Stock card
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {card.store ? `${card.store.name} · ` : ""}
            {periodText(card.from, card.to)}
          </p>
        </div>
        <CardFilters
          store={card.store?.id ?? null}
          from={card.from}
          to={card.to}
          today={screen.today}
          stores={screen.stores}
        >
          <StockCard
            card={card}
            unit={m.unit}
            currency={currency}
            seeCosts={seeCosts}
            manyStores={screen.stores.length > 1}
          />
        </CardFilters>
      </section>
    </div>
  );
}
