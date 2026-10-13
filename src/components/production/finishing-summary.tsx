import { ShirtIcon } from "lucide-react";
import Link from "next/link";

import { FormAlert } from "@/components/forms/field";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { FinishingScreen } from "@/modules/production/finishing.service";

import { cellName } from "./cutting-summary";
import { pieces, productionHref } from "./labels";

/*
 * The parts of a style's finishing that only show: the grades by colour and
 * size, the final unit cost, the packing list's state, and the summary on the
 * project page.
 */

/** A, B, C (mending), rejects, missing and not counted, as facts. */
export function GradeFacts({
  totals,
  currency,
  className,
}: {
  totals: FinishingScreen["totals"];
  currency: string;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6", className)}>
      <Fact label="A-grade">{pieces(totals.a, currency)}</Fact>
      <Fact label="B-grade">{pieces(totals.b, currency)}</Fact>
      <Fact label="C-grade (mending)">{pieces(totals.c, currency)}</Fact>
      <Fact label="Rejects">{pieces(totals.reject, currency)}</Fact>
      <Fact label="Missing">{pieces(totals.missing, currency)}</Fact>
      <Fact label="Not counted">
        {totals.notCounted === null ? (
          <span className="text-muted-foreground">No cutting recorded</span>
        ) : (
          pieces(totals.notCounted, currency)
        )}
      </Fact>
    </dl>
  );
}

const COLUMNS = [
  ["cut", "Cut"],
  ["a", "A"],
  ["b", "B"],
  ["c", "C (mending)"],
  ["reject", "Rejects"],
  ["missing", "Missing"],
  ["notCounted", "Not counted"],
  ["inStock", "In stock"],
] as const;

/** Each colour and size: cut, graded, missing, not counted yet and in stock. */
export function FinishingGrid({ screen, currency }: { screen: FinishingScreen; currency: string }) {
  const head =
    "px-2 py-2 text-left text-[0.75rem] font-medium tracking-wide whitespace-nowrap text-muted-foreground";
  const value = (c: FinishingScreen["cells"][number], key: (typeof COLUMNS)[number][0]) => {
    if (key === "inStock") return c.inStock.a + c.inStock.b;
    return c[key];
  };
  return (
    <Panel title="Pieces by grade" id="grade-grid-heading">
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Every piece cut is graded A, B or C (to mending), rejected for a sewing fault, or missing
        (lost or stolen). Only A and B pieces go to stock.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm tabular-nums">
          <caption className="sr-only">Pieces by grade, colour and size</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className={head}>
                {screen.hasGrid ? "Colour and size" : "Pieces"}
              </th>
              {COLUMNS.map(([key, label]) => (
                <th key={key} scope="col" className={head}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {screen.cells.map((c) => (
              <tr key={cellName(c)} className="border-b last:border-b-0">
                <th scope="row" className="px-2 py-2.5 text-left font-medium whitespace-nowrap">
                  {cellName(c)}
                </th>
                {COLUMNS.map(([key]) => {
                  const n = value(c, key);
                  return (
                    <td
                      key={key}
                      className={cn(
                        "px-2 py-2.5",
                        n === 0 && "text-muted-foreground",
                        key === "missing" && (n ?? 0) > 0 && "font-medium text-destructive",
                        key === "notCounted" && (n ?? 0) > 0 && "font-medium",
                      )}
                    >
                      {n === null ? "–" : formatCount(n, currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Final unit cost: the style's total cost over its A and B pieces (cost viewers only). */
export function FinalUnitCost({ screen, currency }: { screen: FinishingScreen; currency: string }) {
  const { cost, totals } = screen;
  if (!cost) return null;
  return (
    <Panel title="Final unit cost" id="unit-cost-heading">
      {cost.perPiece ? (
        <>
          <p className="mt-3 font-serif text-3xl text-primary tabular-nums">
            {money(cost.perPiece, currency)}
            <span className="ml-2 font-sans text-sm text-muted-foreground">a piece</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed tabular-nums">
            Total cost {money(cost.total, currency)} ÷ (A {formatCount(totals.a, currency)} + B{" "}
            {formatCount(totals.b, currency)})
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Shows once pieces are graded A or B. Total cost so far {money(cost.total, currency)}.
        </p>
      )}
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted-foreground">
        C-grade pieces, rejects and missing pieces never reach stock, so the A and B pieces carry
        the whole cost of the style.
      </p>
    </Panel>
  );
}

/** Where the full packing list stands. */
export function PackingListState({ screen }: { screen: FinishingScreen }) {
  const { packed, project: p } = screen;
  if (!packed) return null;
  return (
    <FormAlert tone="success">
      Full packing list {packed.number} received {formatDay(packed.on)}
      {packed.intake && (
        <>
          {": its A and B pieces are in stock on "}
          <Link
            href={productionHref.delivery(packed.intake.id)}
            className="underline underline-offset-4"
          >
            {packed.intake.number}
          </Link>
        </>
      )}
      .
      {packed.missing > 0 &&
        ` ${packed.missing} ${packed.missing === 1 ? "piece is" : "pieces are"} missing${
          packed.fault ? `, in ${p.factory}'s fault log as ${packed.fault.number}` : ""
        }.`}
    </FormAlert>
  );
}

/** The finishing summary on the project page. */
export function FinishingSummaryPanel({
  screen,
  currency,
}: {
  screen: FinishingScreen;
  currency: string;
}) {
  const { totals, project: p, cost, packed } = screen;
  const graded = totals.a + totals.b + totals.c + totals.reject;
  return (
    <Panel
      title="Finishing and QC"
      id="finishing-heading"
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={productionHref.finishing(p.id)}>
            <ShirtIcon aria-hidden />
            Open finishing
          </Link>
        </Button>
      }
    >
      {graded + totals.missing === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Nothing graded yet. Finishing counts grade pieces A, B or C (mending) with rejects apart,
          and the full packing list moves the A and B pieces to stock.
        </p>
      ) : (
        <>
          <GradeFacts totals={totals} currency={currency} className="mt-4 lg:grid-cols-3" />
          {packed ? (
            <p className="mt-4 text-sm">
              Full packing list {packed.number} received {formatDay(packed.on)}
              {packed.missing > 0 && `, ${packed.missing} missing`}.
            </p>
          ) : (
            totals.toStock.a + totals.toStock.b > 0 && (
              <p className="mt-4 text-sm">
                {pieces(totals.toStock.a + totals.toStock.b, currency)} graded A or B wait for the
                full packing list.
              </p>
            )
          )}
          {cost?.perPiece && (
            <p className="mt-2 text-sm tabular-nums">
              Final unit cost <span className="font-medium">{money(cost.perPiece, currency)}</span>
              <span className="text-muted-foreground"> (total ÷ A and B pieces)</span>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
