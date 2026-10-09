"use client";

import { Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FormAlert } from "@/components/forms/field";
import { Panel, Totals } from "@/components/sales/detail-bits";
import { StatusBadge } from "@/components/sales/badges";
import { isZero, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ProjectScreen } from "@/modules/production/screens.service";

import { BillBadge } from "./badges";
import { VoidCostDialog } from "./cost-dialogs";
import { COST_HEAD_CATEGORY_LABELS, pieces, productionHref } from "./labels";

type Costs = NonNullable<ProjectScreen["costs"]>;
type Entry = Costs["entries"][number];

/** What the project cost, where that cost went (stock, written off) and what is left in production. */
export function CostSummary({ costs, currency }: { costs: Costs; currency: string }) {
  return (
    <Panel title="Costs" id="costs-heading">
      <Totals
        className="mt-4"
        currency={currency}
        lines={[
          { label: "Supplier bills", amount: costs.billCost, optional: true },
          { label: "Paid directly", amount: costs.directCost, optional: true },
          { label: "Raw materials", amount: costs.materialCost, optional: true },
          { label: "Total cost", amount: costs.totalCost, strong: true },
          { label: "Moved into stock", amount: costs.inStock },
          { label: "Written off", amount: costs.writtenOff, optional: true },
          { label: "Still in production", amount: costs.wip, tone: "muted" },
        ]}
      />
      {costs.byHead.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <h4 className="eyebrow">By cost head</h4>
          <ul className="mt-3 grid gap-2 text-sm">
            {costs.byHead.map((head) => (
              <li key={head.headId} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0">
                  <span className="break-words">{head.name}</span>
                  {COST_HEAD_CATEGORY_LABELS[head.category] && (
                    <span className="ml-1.5 text-[0.75rem] text-muted-foreground">
                      {COST_HEAD_CATEGORY_LABELS[head.category]}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {money(head.amount, currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {costs.materials.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <h4 className="eyebrow">Raw materials used</h4>
          <ul className="mt-3 grid gap-2 text-sm">
            {costs.materials.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 break-words">
                  {m.name}
                  <span className="ml-1.5 text-[0.8125rem] text-muted-foreground tabular-nums">
                    {m.quantity} {m.unit}
                  </span>
                </span>
                <span className="whitespace-nowrap tabular-nums">{money(m.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function GradeBox({
  grade,
  figures,
  currency,
}: {
  grade: "A" | "B";
  figures: Costs["grades"]["a"];
  currency: string;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/30 p-3">
      <dt className="eyebrow">{grade}-grade</dt>
      <dd className="mt-1">
        <p className="font-serif text-lg leading-tight tabular-nums">
          {figures.perPiece ? money(figures.perPiece, currency) : "None yet"}
        </p>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground tabular-nums">
          {figures.pieces > 0
            ? `${pieces(figures.pieces, currency)} · ${money(figures.value, currency)}`
            : "a piece"}
        </p>
      </dd>
    </div>
  );
}

/**
 * What an A-grade and a B-grade piece cost: what each delivery carried into
 * stock with its pieces, per piece, next to the cost expected for a piece.
 */
export function GradeCosts({
  costs,
  targetQuantity,
  currency,
}: {
  costs: Costs;
  targetQuantity: number;
  currency: string;
}) {
  return (
    <Panel title="Cost a piece" id="grade-heading">
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <GradeBox grade="A" figures={costs.grades.a} currency={currency} />
        <GradeBox grade="B" figures={costs.grades.b} currency={currency} />
      </dl>
      <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
        At {money(costs.totalCost, currency)} so far over {formatCount(targetQuantity, currency)}{" "}
        pieces, a piece is expected to cost{" "}
        <span className="font-medium text-foreground tabular-nums">
          {money(costs.estimatedCostPerPiece, currency)}
        </span>
        .
        {costs.actualCostPerPiece &&
          ` The pieces received carried ${money(costs.actualCostPerPiece, currency)} each on average.`}
      </p>
    </Panel>
  );
}

function entryNote(entry: Entry) {
  if (entry.kind === "BILL") {
    return entry.paymentType === "CASH_BANK" ? "Paid now" : "Due to the supplier";
  }
  if (entry.kind === "DIRECT") return entry.from;
  return entry.from;
}

/**
 * Every cost on the project, oldest first: supplier bill shares (opening their
 * bill), costs paid from cash or bank (which Accounts may void while they are
 * still in production) and raw materials issued or returned.
 */
export function CostEntries({ costs, currency }: { costs: Costs; currency: string }) {
  const [voiding, setVoiding] = useState<Entry | null>(null);
  const [notice, setNotice] = useState<string>();

  return (
    <Panel title="Cost entries" id="entries-heading">
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {costs.entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No costs yet. Supplier bills, costs paid from cash and raw materials issued to it show
          here.
        </p>
      ) : (
        <ul className="mt-4 grid divide-y">
          {costs.entries.map((entry) => {
            const negative = entry.amount.startsWith("-");
            const title =
              entry.kind === "BILL" && entry.billId ? (
                <Link
                  href={productionHref.bill(entry.billId)}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {entry.number}
                </Link>
              ) : (
                <span className="font-medium">{entry.number}</span>
              );
            return (
              <li
                key={`${entry.kind}-${entry.id}`}
                className={cn(
                  "grid min-w-0 gap-1 py-3 first:pt-0 last:pb-0",
                  entry.isVoid && "text-muted-foreground",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {title}
                      <span className="break-words">{entry.label}</span>
                      {entry.isVoid && <StatusBadge tone="closed">Void</StatusBadge>}
                      {!entry.isVoid && entry.billStatus && <BillBadge status={entry.billStatus} />}
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] break-words text-muted-foreground">
                      {formatDay(entry.on)} · {entryNote(entry)}
                      {entry.kind === "BILL" && ` · ${entry.from}`}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "text-right text-sm whitespace-nowrap tabular-nums",
                      entry.isVoid && "line-through",
                      negative && "text-muted-foreground",
                    )}
                  >
                    {negative
                      ? `− ${money(entry.amount.slice(1), currency)}`
                      : money(entry.amount, currency)}
                  </p>
                </div>
                {entry.description && (
                  <p className="text-[0.8125rem] break-words whitespace-pre-line">
                    {entry.description}
                  </p>
                )}
                {entry.voidReason && <p className="text-[0.8125rem]">Voided: {entry.voidReason}</p>}
                {entry.canVoid && !isZero(entry.amount) && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2 text-destructive hover:text-destructive"
                      onClick={() => setVoiding(entry)}
                    >
                      <Trash2Icon aria-hidden />
                      Void {entry.number}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {voiding && (
        <VoidCostDialog
          cost={voiding}
          currency={currency}
          onDone={(message) => {
            setNotice(message);
            setVoiding(null);
          }}
          onClose={() => setVoiding(null)}
        />
      )}
    </Panel>
  );
}
