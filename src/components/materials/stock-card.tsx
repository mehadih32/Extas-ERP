import type { MeasurementUnit } from "@prisma/client";
import Link from "next/link";

import { signedMoney } from "@/components/accounts/labels";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { MaterialScreen } from "@/modules/materials/screens.service";

import { MOVEMENT_LABELS, quantity } from "./labels";

type Card = MaterialScreen["card"];
type Line = Card["lines"][number];

const linkClass =
  "rounded-sm text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/25";
const isOut = (text: string) => text.startsWith("-");

/** Where it came from or went: the bill or note, the supplier, the project, the other store. */
function Where({ line, nameStore }: { line: Line; nameStore: boolean }) {
  const parts: React.ReactNode[] = [];
  if (line.document) {
    parts.push(
      line.document.href ? (
        <Link key="doc" href={line.document.href} className={linkClass}>
          {line.document.number}
        </Link>
      ) : (
        <span key="doc">{line.document.number}</span>
      ),
    );
  }
  if (line.supplier) parts.push(<span key="supplier">{line.supplier}</span>);
  if (line.project) {
    parts.push(
      line.project.href ? (
        <Link key="project" href={line.project.href} className={linkClass}>
          {line.project.code}
        </Link>
      ) : (
        <span key="project">{line.project.code}</span>
      ),
    );
  }
  if (line.otherStore) {
    parts.push(
      <span key="stores">
        {line.type === "TRANSFER_OUT"
          ? `${line.store} to ${line.otherStore}`
          : `${line.otherStore} to ${line.store}`}
      </span>,
    );
  } else if (nameStore) parts.push(<span key="store">{line.store}</span>);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

/**
 * A material's stock card: what it held when the days chosen began, each
 * movement in and out with the running balance (cards on phones, a table from
 * tablets up), and what it held at the end. Values show to people who see
 * material prices, for the whole company only (a store's share of the value is
 * not kept).
 */
export function StockCard({
  card,
  unit,
  currency,
  seeCosts,
  manyStores,
}: {
  card: Card;
  unit: MeasurementUnit;
  currency: string;
  seeCosts: boolean;
  /** The company keeps more than one store: each line names its own. */
  manyStores: boolean;
}) {
  const q = (text: string) => quantity(text, unit, currency);
  const everyStore = card.store === null;
  const showValue = seeCosts && everyStore;
  const nameStore = everyStore && manyStores;
  const figures = [
    { label: "At the start", value: q(card.opening.quantity), money: card.opening.value },
    { label: "Came in", value: q(card.totalIn) },
    { label: "Went out", value: q(card.totalOut) },
    { label: "At the end", value: q(card.closing.quantity), money: card.closing.value },
  ];
  const last = card.lines[card.lines.length - 1];

  return (
    <div className="grid grid-cols-1 gap-4">
      <section
        aria-labelledby="card-summary-heading"
        className="rounded-lg border bg-card p-5 sm:p-6"
      >
        <h4 id="card-summary-heading" className="sr-only">
          Summary
        </h4>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="eyebrow">{f.label}</dt>
              <dd className="mt-1 font-serif text-lg leading-tight break-words tabular-nums sm:text-xl">
                {f.value}
              </dd>
              {showValue && f.money && (
                <dd className="mt-1 text-[0.8125rem] text-muted-foreground tabular-nums">
                  {signedMoney(f.money, currency)}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      {card.cutShort && last && (
        <FormAlert tone="note">
          These days have more movements than one card shows, so it stops at {formatDay(last.day)}.
          Choose fewer days to see the rest.
        </FormAlert>
      )}
      {card.hiddenCount > 0 && (
        <FormAlert tone="note">
          The latest {formatCount(card.lines.length, currency)} movements are shown. Choose fewer
          days to see the {formatCount(card.hiddenCount, currency)} before them.
        </FormAlert>
      )}

      {card.lines.length === 0 ? (
        <EmptyState title="Nothing moved in these days">
          Choose other days, or everything.
        </EmptyState>
      ) : (
        <>
          <ol className="grid grid-cols-1 gap-3 md:hidden" aria-label="Movements">
            {card.lines.map((line) => (
              <li key={line.id} className="min-w-0 rounded-lg border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{MOVEMENT_LABELS[line.type]}</span>
                  <span className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                    {formatDay(line.day)}
                  </span>
                </div>
                <div className="mt-1 text-[0.8125rem] break-words text-muted-foreground">
                  <Where line={line} nameStore={nameStore} />
                  {line.note && <p className="mt-0.5">{line.note}</p>}
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3 border-t pt-3 text-sm tabular-nums">
                  <span className={cn(isOut(line.quantity) ? "text-destructive" : "text-success")}>
                    {isOut(line.quantity) ? "" : "+"}
                    {q(line.quantity)}
                    {showValue && line.value && (
                      <span className="ml-1.5 text-muted-foreground">
                        {signedMoney(line.value, currency)}
                      </span>
                    )}
                  </span>
                  <span className="font-medium">{q(line.balance)}</span>
                </div>
              </li>
            ))}
          </ol>
          <div className="hidden md:block">
            <Table aria-label="Movements">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  {showValue && <TableHead className="text-right">Value</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="whitespace-nowrap">{formatDay(line.day)}</TableCell>
                    <TableCell className="min-w-56">
                      {MOVEMENT_LABELS[line.type]}
                      <span className="block text-[0.8125rem] text-muted-foreground">
                        <Where line={line} nameStore={nameStore} />
                      </span>
                      {line.note && (
                        <span className="block max-w-80 truncate text-[0.8125rem] text-muted-foreground">
                          {line.note}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {isOut(line.quantity) ? "" : q(line.quantity)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {isOut(line.quantity) ? q(line.quantity.slice(1)) : ""}
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                      {q(line.balance)}
                    </TableCell>
                    {showValue && (
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                        {line.value ? signedMoney(line.value, currency) : "–"}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
