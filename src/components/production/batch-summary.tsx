import { FileDownIcon } from "lucide-react";
import Link from "next/link";

import { Figure } from "@/components/parties/profile-bits";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { BatchSummary } from "@/modules/production/batch-summary.service";

import { productionHref } from "./labels";

/*
 * A master batch's money story on one page: the headline figures, each style's
 * pieces and cost a piece, where the money went, the penalties and deductions,
 * and what reached stock, with the PDF to share.
 */

const head =
  "px-2 py-2 text-left text-[0.75rem] font-medium tracking-wide whitespace-nowrap text-muted-foreground";
const num = "px-2 py-2.5 text-right tabular-nums";

/** Total cost, cost a good piece against the target, what came back from suppliers, stock. */
export function SummaryFigures({ s, currency }: { s: BatchSummary; currency: string }) {
  const m = s.money;
  const over = m.perPiece && m.targetPrice && Number(m.perPiece) > Number(m.targetPrice);
  return (
    <section aria-labelledby="summary-glance" className="grid gap-4">
      <h3 id="summary-glance" className="font-serif text-xl text-primary">
        At a glance
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Total cost"
          value={money(m.totalCost, currency)}
          note={`${formatCount(s.pieces.target, currency)} pieces to make, ${formatCount(s.styles.length, currency)} styles`}
        />
        <Figure
          label="Cost a good piece"
          value={m.perPiece ? money(m.perPiece, currency) : "–"}
          tone={over ? "warn" : "plain"}
          note={
            m.targetPrice
              ? `Target ${money(m.targetPrice, currency)} a piece${over ? ": over it" : ""}`
              : "No target price set"
          }
        />
        <Figure
          label="Taken back from suppliers"
          value={money(m.recovered, currency)}
          note={
            m.netPerPiece
              ? `Net cost ${money(m.netPerPiece, currency)} a good piece`
              : "Faults and rejects over the allowance"
          }
        />
        <Figure
          label="In stock"
          value={`${formatCount(s.stock.a + s.stock.b, currency)} pieces`}
          note={`${formatCount(s.stock.a, currency)} A, ${formatCount(s.stock.b, currency)} B, worth ${money(s.stock.value, currency)}`}
        />
      </div>
    </section>
  );
}

/** Each style's pieces by grade, its cost and its cost a good piece. */
export function SummaryStyles({ s, currency }: { s: BatchSummary; currency: string }) {
  const count = (n: number | null) => (n === null ? "–" : formatCount(n, currency));
  const p = s.pieces;
  return (
    <Panel title="Pieces and cost by style" id="summary-styles">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Only A and B pieces reach stock, so a good piece carries the whole cost: cost a piece =
        total cost ÷ (A + B).
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <caption className="sr-only">Pieces and cost by style</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className={head}>
                Style
              </th>
              {["Cut", "A", "B", "C", "Rejects", "Missing", "Cost", "A piece"].map((label) => (
                <th key={label} scope="col" className={cn(head, "text-right")}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.styles.map((st) => {
              const over =
                st.perPiece && st.targetPrice && Number(st.perPiece) > Number(st.targetPrice);
              return (
                <tr key={st.id} className="border-b">
                  <th scope="row" className="px-2 py-2.5 text-left font-medium">
                    <Link
                      href={productionHref.project(st.id)}
                      className="underline-offset-4 hover:underline"
                    >
                      {st.code}
                    </Link>
                    <span className="block text-[0.75rem] font-normal text-muted-foreground">
                      {st.name}, {count(st.target)} to make
                    </span>
                  </th>
                  <td className={num}>{count(st.cut)}</td>
                  <td className={num}>{count(st.a)}</td>
                  <td className={num}>{count(st.b)}</td>
                  <td className={num}>{count(st.c)}</td>
                  <td className={num}>{count(st.reject)}</td>
                  <td className={cn(num, st.missing > 0 && "text-destructive")}>
                    {count(st.missing)}
                  </td>
                  <td className={num}>{money(st.totalCost, currency)}</td>
                  <td className={cn(num, "font-medium")}>
                    {st.perPiece ? money(st.perPiece, currency) : "–"}
                    {st.targetPrice && (
                      <span
                        className={cn(
                          "block text-[0.75rem] font-normal",
                          over ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        target {money(st.targetPrice, currency)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="px-2 py-2.5 text-left font-medium">
                Batch
              </th>
              <td className={num}>{count(p.cut)}</td>
              <td className={num}>{count(p.a)}</td>
              <td className={num}>{count(p.b)}</td>
              <td className={num}>{count(p.c)}</td>
              <td className={num}>{count(p.reject)}</td>
              <td className={num}>{count(p.missing)}</td>
              <td className={cn(num, "font-semibold")}>{money(s.money.totalCost, currency)}</td>
              <td className={cn(num, "font-semibold")}>
                {s.money.perPiece ? money(s.money.perPiece, currency) : "–"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

/** Each cost head and each material issued, largest first; and who was billed. */
export function SummarySpent({ s, currency }: { s: BatchSummary; currency: string }) {
  return (
    <Panel title="Where the money went" id="summary-spent">
      {s.spent.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No cost on this batch yet.</p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border" aria-label="Costs">
          {s.spent.map((l) => (
            <li
              key={`${l.kind}-${l.what}`}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
            >
              <span className="min-w-0 text-sm">
                {l.what}
                {l.quantity && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {l.quantity} {l.unit?.toLowerCase()}
                  </span>
                )}
              </span>
              <span className="text-sm font-medium tabular-nums">{money(l.amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {s.suppliers.length > 0 && (
        <>
          <h4 className="mt-5 text-sm font-medium">Billed by supplier</h4>
          <ul className="mt-2 grid gap-1.5 text-sm" aria-label="Billed by supplier">
            {s.suppliers.map((x) => (
              <li key={x.id} className="flex flex-wrap justify-between gap-2">
                <Link
                  href={productionHref.supplier(x.id)}
                  className="underline-offset-4 hover:underline"
                >
                  {x.name}
                </Link>
                <span className="tabular-nums">{money(x.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** The factory's CM settlement (saved or as it stands) and every fault on the batch. */
export function SummaryPenalties({ s, currency }: { s: BatchSummary; currency: string }) {
  const { cm, faults } = s.penalties;
  const t = cm.totals;
  return (
    <Panel
      title="Penalties and deductions"
      id="summary-penalties"
      action={
        <Link
          href={productionHref.cmSettlement(s.batch.id)}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          CM settlement
        </Link>
      }
    >
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Rejects up to {cm.rejectAllowancePercent ?? s.batch.rejectAllowancePercent}% of the pieces
        cut are free; the ones over it are charged at the style&apos;s target price. Missing pieces
        are charged to the factory in full, and pieces spoiled at embroidery or print to that house.
      </p>
      <dl className="mt-4 grid gap-2 text-sm tabular-nums">
        <div className="flex justify-between gap-3">
          <dt>Total CM</dt>
          <dd>{money(t.totalCm, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Less faults (missing pieces…)</dt>
          <dd>− {money(t.faults, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Less rejects over the allowance</dt>
          <dd>− {money(t.rejects, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Less advance taken and paid</dt>
          <dd>− {money(t.paid, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t pt-2 font-medium">
          <dt>
            Final payable to the factory
            <span className="block text-[0.75rem] font-normal text-muted-foreground">
              {cm.saved ? `Settled on ${cm.saved.number}` : "Not settled yet: as it stands today"}
            </span>
          </dt>
          <dd>{money(t.payable, currency)}</dd>
        </div>
      </dl>
      {cm.overAllowance.length > 0 && (
        <ul className="mt-4 divide-y rounded-md border" aria-label="Rejects over the allowance">
          {cm.overAllowance.map((o) => (
            <li
              key={o.code}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
            >
              <span className="min-w-0 text-sm">
                <span className="font-medium">Rejects over the allowance</span>
                <span className="text-muted-foreground"> · {o.code}</span>
                <span className="block text-[0.75rem] text-muted-foreground">
                  {formatCount(o.over, currency)} of {formatCount(o.reject, currency)} rejects over
                  the allowance of {formatCount(o.allowance ?? 0, currency)}
                </span>
              </span>
              <span className="text-sm font-medium tabular-nums">
                {o.targetPrice ? money(o.amount, currency) : "No target price"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {faults.length > 0 && (
        <ul className="mt-4 divide-y rounded-md border" aria-label="Faults on the batch">
          {faults.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2.5"
            >
              <span className="min-w-0 text-sm">
                <span className="font-medium">{f.number}</span> · {f.what}
                {f.style && <span className="text-muted-foreground"> · {f.style}</span>}
                <span className="block text-[0.75rem] break-words text-muted-foreground">
                  {f.supplier.name}
                  {f.quantity && ` · ${f.quantity}`}
                </span>
              </span>
              <span className="flex items-center gap-2 text-sm tabular-nums">
                <StatusBadge
                  tone={f.status === "OPEN" ? "warn" : f.status === "DEDUCTED" ? "done" : "closed"}
                >
                  {f.offTheirDue ? "Off their due" : f.statusText}
                </StatusBadge>
                {f.amount ? money(f.amount, currency) : "To agree"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** A and B pieces delivered to stock, by warehouse, with their value. */
export function SummaryStock({ s, currency }: { s: BatchSummary; currency: string }) {
  return (
    <Panel title="Delivered to stock" id="summary-stock">
      {s.stock.rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing delivered to stock yet.</p>
      ) : (
        <ul className="mt-4 grid gap-2 text-sm" aria-label="Stock by warehouse">
          {s.stock.rows.map((r) => (
            <li key={r.warehouse} className="flex flex-wrap justify-between gap-2">
              <span>
                {r.warehouse}
                <span className="block text-[0.75rem] text-muted-foreground">
                  {formatCount(r.a, currency)} A, {formatCount(r.b, currency)} B
                </span>
              </span>
              <span className="font-medium tabular-nums">{money(r.value, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The PDF of the whole page. */
export function SummaryPdfButton({ batchId }: { batchId: string }) {
  return (
    <Button asChild variant="outline" className="w-full sm:w-auto">
      <a href={productionHref.batchSummaryPdf(batchId)} download>
        <FileDownIcon aria-hidden />
        Download the PDF
      </a>
    </Button>
  );
}
