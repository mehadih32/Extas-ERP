import Link from "next/link";

import { accountsHref } from "@/components/accounts/labels";
import { OrderBadge as PurchaseOrderBadge } from "@/components/materials/badges";
import { materialsHref, quantity } from "@/components/materials/labels";
import { BillBadge, ProjectBadge } from "@/components/production/badges";
import { productionHref, STAGE_LABELS } from "@/components/production/labels";
import { StatusBadge } from "@/components/sales/badges";
import { METHOD_LABELS } from "@/components/sales/labels";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { Supplier360, SupplierHistory } from "@/modules/parties/supplier-360.service";

import {
  amount,
  DocumentsPanel,
  Empty,
  Figure,
  isZero,
  linkClass,
  List,
  Panel,
  plural,
  Row,
  ShowAll,
} from "./profile-bits";

/*
 * The Supplier 360° parts of a supplier's profile: the figures at a glance,
 * their active and completed projects (each with what it was billed, paid and
 * still owes them, and the settlement made when it closed), the goods they
 * delivered, and their purchase orders, bills, payments and documents.
 * Everything comes from getSupplier360, which leaves out (null) what the person
 * may not see, so a missing part is simply not drawn.
 */

type Project = NonNullable<Supplier360["activeProjects"]>["items"][number];

/** Whether the person sees anything beyond the profile's own balance. */
export function showsSupplier360(data: Supplier360): boolean {
  return data.shows.money || data.shows.production || data.shows.materials;
}

// =============================================================================
// At a glance
// =============================================================================

/** What is due to them, billed and paid in all, open bills, projects and deliveries. */
export function SupplierFigures({ data, currency }: { data: Supplier360; currency: string }) {
  if (!showsSupplier360(data)) return null;
  const { figures } = data;
  const cards = [
    <Figure
      key="due"
      label="Due to them"
      value={amount(figures.dueToThem, currency)}
      tone={isZero(figures.dueToThem) ? "plain" : "warn"}
      note={
        isZero(figures.advanceWithThem)
          ? "On their ledger today, every project and bill together"
          : `They hold ${amount(figures.advanceWithThem, currency)} of yours as advance`
      }
    />,
  ];
  if (figures.billed) {
    cards.push(
      <Figure
        key="billed"
        label="Billed in all"
        value={amount(figures.billed.total, currency)}
        note={plural(figures.billed.bills, "bill", currency)}
      />,
      <Figure
        key="open"
        label="Open bills"
        value={amount(figures.billed.open, currency)}
        note={
          figures.billed.openBills > 0
            ? `${plural(figures.billed.openBills, "bill", currency)} not fully paid`
            : "Every bill is paid"
        }
      />,
    );
  }
  if (figures.paid) {
    cards.push(
      <Figure
        key="paid"
        label="Paid to them"
        value={amount(figures.paid.total, currency)}
        note={plural(figures.paid.payments, "payment", currency)}
      />,
    );
  }
  if (figures.projects) {
    cards.push(
      <Figure
        key="projects"
        label="Projects"
        value={`${formatCount(figures.projects.active, currency)} active`}
        note={`${formatCount(figures.projects.completed, currency)} completed`}
      />,
    );
  }
  if (figures.deliveries) {
    cards.push(
      <Figure
        key="deliveries"
        label="Deliveries"
        value={formatCount(figures.deliveries.total, currency)}
        note={
          figures.deliveries.lastOn
            ? `The last on ${formatDay(figures.deliveries.lastOn)}`
            : "Nothing delivered yet"
        }
      />,
    );
  }
  return (
    <section aria-labelledby="glance-heading" className="grid gap-4">
      <h3 id="glance-heading" className="font-serif text-xl text-primary">
        At a glance
      </h3>
      <div
        className={cn(
          "grid grid-cols-1 gap-4 sm:grid-cols-2",
          cards.length > 4 ? "lg:grid-cols-3" : "xl:grid-cols-4",
          cards.length === 6 && "2xl:grid-cols-6",
        )}
      >
        {cards}
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">
        {data.runningLedger
          ? "An accessories supplier: their bills run on one continuous ledger, whatever the project."
          : "Their bills are settled project by project: when a project is completed its balance with them becomes zero, and anything still due stays on their ledger."}
      </p>
    </section>
  );
}

// =============================================================================
// Projects
// =============================================================================

function ProjectRow({
  project: p,
  data,
  currency,
}: {
  project: Project;
  data: Supplier360;
  currency: string;
}) {
  const n = (value: number) => formatCount(value, currency);
  const settlement = p.money?.settlement ?? null;
  const owed = settlement ? settlement.stillDue : (p.money?.balance ?? "0");
  const when = p.completedOn
    ? `Done ${formatDay(p.completedOn)}`
    : `Started ${formatDay(p.startedOn)} · target ${formatDay(p.targetOn)}`;
  const role = [p.asFactory ? "Their factory" : null, p.buyer ? `for ${p.buyer.name}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <Row
      href={data.can.openProjects ? productionHref.project(p.id) : undefined}
      title={`${p.code} · ${p.name}`}
      meta={[when, role].filter(Boolean).join(" · ")}
      badges={
        <>
          <ProjectBadge status={p.status} />
          {p.status === "ACTIVE" && p.stage !== "COMPLETED" && (
            <StatusBadge tone="plain">{STAGE_LABELS[p.stage]}</StatusBadge>
          )}
          {settlement && <StatusBadge tone="done">Settled</StatusBadge>}
        </>
      }
      value={
        p.money
          ? settlement
            ? "Balance zero"
            : isZero(p.money.balance)
              ? isZero(p.money.billed)
                ? "No bills"
                : "Paid"
              : `${amount(p.money.balance, currency)} due`
          : p.asFactory
            ? `${n(p.produced)} of ${n(p.targetQuantity)}`
            : undefined
      }
      sub={
        p.money
          ? `Billed ${amount(p.money.billed, currency)} · paid ${amount(p.money.paid, currency)}`
          : p.asFactory
            ? "pcs"
            : undefined
      }
    >
      {settlement && (
        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
          Settled on {formatDay(settlement.settledOn)}:{" "}
          {isZero(settlement.carried)
            ? "paid in full."
            : `${amount(settlement.carried, currency)} left on their ledger${
                isZero(settlement.stillDue)
                  ? ", since paid."
                  : `, ${amount(settlement.stillDue, currency)} of it still unpaid.`
              }`}
        </p>
      )}
      {data.can.pay && p.money && !isZero(owed) && (
        <p className="mt-1 text-[0.8125rem]">
          <Link href={accountsHref.pay(data.party.id, p.id)} className={linkClass}>
            Pay for {p.code}
          </Link>
        </p>
      )}
    </Row>
  );
}

function ProjectsPanel({
  data,
  which,
  currency,
  open,
  basePath,
}: {
  data: Supplier360;
  which: "active" | "completed";
  currency: string;
  open?: SupplierHistory;
  basePath: string;
}) {
  const list = which === "active" ? data.activeProjects : data.completedProjects;
  if (!list) return null;
  const heading = `${which}-heading`;
  return (
    <Panel
      title={which === "active" ? "Active projects" : "Completed projects"}
      id={heading}
      count={list.total}
      footer={
        <ShowAll
          history={which}
          shown={list.items.length}
          total={list.total}
          open={open}
          basePath={basePath}
          heading={heading}
        />
      }
    >
      {list.items.length === 0 ? (
        <Empty>
          {which === "active"
            ? "No running projects with them."
            : "No completed projects with them yet."}
        </Empty>
      ) : (
        <List label={which === "active" ? "Active projects" : "Completed projects"}>
          {list.items.map((p) => (
            <ProjectRow key={p.id} project={p} data={data} currency={currency} />
          ))}
        </List>
      )}
    </Panel>
  );
}

// =============================================================================
// Everything else
// =============================================================================

export function SupplierPanels({
  data,
  currency,
  open,
  basePath,
}: {
  data: Supplier360;
  currency: string;
  /** The list shown in full (?show=). */
  open?: SupplierHistory;
  /** The profile's address, for "Show all". */
  basePath: string;
}) {
  const { deliveries, orders, bills, payments, documents, can } = data;
  const n = (value: number) => formatCount(value, currency);
  const drawn = [
    data.activeProjects,
    data.completedProjects,
    deliveries,
    orders,
    bills,
    payments,
  ].filter(Boolean).length;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ProjectsPanel
        data={data}
        which="active"
        currency={currency}
        open={open}
        basePath={basePath}
      />
      <ProjectsPanel
        data={data}
        which="completed"
        currency={currency}
        open={open}
        basePath={basePath}
      />

      {deliveries && (
        <Panel
          title="Deliveries"
          id="deliveries-heading"
          count={deliveries.total}
          footer={
            <ShowAll
              history="deliveries"
              shown={deliveries.items.length}
              total={deliveries.total}
              open={open}
              basePath={basePath}
              heading="deliveries-heading"
            />
          }
        >
          {deliveries.items.length === 0 ? (
            <Empty>Nothing delivered yet.</Empty>
          ) : (
            <List label="Deliveries">
              {deliveries.items.map((d) => {
                const goods = d.kind === "GOODS";
                const href = goods
                  ? can.openDeliveries
                    ? productionHref.delivery(d.id)
                    : undefined
                  : materialsHref.purchase(d.id);
                const where = [
                  formatDay(d.deliveredOn),
                  d.warehouse ? `into ${d.warehouse}` : null,
                  d.order?.number ?? null,
                  d.project?.code ?? null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const what = goods
                  ? `${n(d.pieces!.a)} A-grade${d.pieces!.b > 0 ? `, ${n(d.pieces!.b)} B-grade` : ""} pieces`
                  : d
                      .materials!.map((i) => `${i.name} ${quantity(i.quantity, i.unit, currency)}`)
                      .join(", ");
                return (
                  <Row
                    key={`${d.kind}:${d.id}`}
                    href={href}
                    title={d.number}
                    meta={where}
                    badges={
                      <>
                        <StatusBadge tone="plain">
                          {goods ? "Finished goods" : "Raw materials"}
                        </StatusBadge>
                        {d.undone && (
                          <StatusBadge tone="closed">{goods ? "Undone" : "Void"}</StatusBadge>
                        )}
                      </>
                    }
                    value={d.value ? amount(d.value, currency) : undefined}
                  >
                    <p className="mt-0.5 text-[0.8125rem] break-words">{what}</p>
                  </Row>
                );
              })}
            </List>
          )}
        </Panel>
      )}

      {orders && (
        <Panel
          title="Purchase orders"
          id="orders-heading"
          count={orders.total}
          footer={
            <ShowAll
              history="orders"
              shown={orders.items.length}
              total={orders.total}
              open={open}
              basePath={basePath}
              heading="orders-heading"
            />
          }
        >
          {orders.total > 0 && (
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {orders.open > 0
                ? `${plural(orders.open, "order", currency)} still waiting for goods`
                : "Nothing is waiting for goods"}
            </p>
          )}
          {orders.items.length === 0 ? (
            <Empty>No purchase orders yet.</Empty>
          ) : (
            <List label="Purchase orders">
              {orders.items.map((o) => (
                <Row
                  key={o.id}
                  href={materialsHref.order(o.id)}
                  title={o.number}
                  meta={[
                    formatDay(o.orderedOn),
                    o.expectedOn ? `expected ${formatDay(o.expectedOn)}` : null,
                    o.project?.code ?? null,
                    plural(o.lines, "line", currency),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badges={<PurchaseOrderBadge status={o.status} />}
                  value={o.total ? amount(o.total, currency) : undefined}
                />
              ))}
            </List>
          )}
        </Panel>
      )}

      {bills && (
        <Panel
          title="Bills"
          id="bills-heading"
          count={bills.total}
          footer={
            <ShowAll
              history="bills"
              shown={bills.items.length}
              total={bills.total}
              open={open}
              basePath={basePath}
              heading="bills-heading"
            />
          }
        >
          {bills.items.length === 0 ? (
            <Empty>No bills yet.</Empty>
          ) : (
            <List label="Bills">
              {bills.items.map((b) => (
                <Row
                  key={b.id}
                  href={
                    b.opens === "purchase"
                      ? materialsHref.purchase(b.id)
                      : b.opens === "bill"
                        ? productionHref.bill(b.id)
                        : undefined
                  }
                  title={b.number}
                  meta={[
                    formatDay(b.billOn),
                    b.isPurchase ? "Raw materials" : b.heads.join(", "),
                    b.projects.join(", "),
                    b.reference ? `their bill ${b.reference}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badges={<BillBadge status={b.status} />}
                  value={amount(b.total, currency)}
                  sub={
                    b.status === "VOID"
                      ? "Void"
                      : isZero(b.due)
                        ? "Paid"
                        : `Due ${amount(b.due, currency)}`
                  }
                />
              ))}
            </List>
          )}
        </Panel>
      )}

      {payments && (
        <Panel
          title="Payments made"
          id="payments-heading"
          count={payments.total}
          footer={
            <ShowAll
              history="payments"
              shown={payments.items.length}
              total={payments.total}
              open={open}
              basePath={basePath}
              heading="payments-heading"
            />
          }
        >
          {payments.items.length === 0 ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <>
              {data.figures.paid && (
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                  {amount(data.figures.paid.total, currency)} paid in all
                </p>
              )}
              <List label="Payments made">
                {payments.items.map((p) => (
                  <Row
                    key={p.id}
                    href={can.openPayments ? accountsHref.payment(p.id) : undefined}
                    title={p.number}
                    meta={`${formatDay(p.paidOn)} · ${METHOD_LABELS[p.method]} · ${
                      p.bill
                        ? `bill ${p.bill.number}`
                        : p.project
                          ? `for ${p.project.code}`
                          : "on account"
                    }`}
                    badges={p.voided ? <StatusBadge tone="closed">Void</StatusBadge> : undefined}
                    value={amount(p.amount, currency)}
                  />
                ))}
              </List>
            </>
          )}
        </Panel>
      )}

      <DocumentsPanel
        documents={documents}
        history="documents"
        open={open}
        basePath={basePath}
        // Alone on its row when the panels above leave it no partner.
        className={cn(drawn % 2 === 0 && "lg:col-span-2")}
      />
    </div>
  );
}
