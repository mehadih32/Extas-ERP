import { CheckIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { salesHref } from "./labels";

/*
 * The B2B steps a deal goes through, shown on the quotation, the proforma
 * invoice and the order made from it: Quotation → Proforma invoice → Sales
 * order. Each step made links to its record; the step on screen is marked.
 */

type Step = "quotation" | "proforma" | "order";
type Record = { id: string; number: string } | null;

const STEPS: ReadonlyArray<{ key: Step; label: string; short: string }> = [
  { key: "quotation", label: "Quotation", short: "Quotation" },
  { key: "proforma", label: "Proforma invoice", short: "Proforma" },
  { key: "order", label: "Sales order", short: "Order" },
];

/** A number like QT-2026-00011 that wraps after a dash on a narrow phone, never mid-digits. */
const Breakable = ({ number }: { number: string }) =>
  number.split("-").map((part, index) => (
    <span key={index}>
      {index > 0 && (
        <>
          -<wbr />
        </>
      )}
      {part}
    </span>
  ));

const hrefOf = (step: Step, id: string) =>
  step === "quotation"
    ? salesHref.quotation(id)
    : step === "proforma"
      ? salesHref.proforma(id)
      : salesHref.order(id);

export function SalesFlow({
  current,
  quotation,
  proforma,
  order,
}: {
  current: Step;
  quotation: Record;
  proforma: Record;
  order: Record;
}) {
  const records: { [key in Step]: Record } = { quotation, proforma, order };
  return (
    <nav aria-label="From quotation to order">
      <ol className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1 text-[0.8125rem]">
        {STEPS.map((step, index) => {
          const record = records[step.key];
          const here = step.key === current;
          return (
            <li
              key={step.key}
              className={cn(
                "grid min-w-0 content-start gap-0.5 rounded-md px-2 py-1.5 sm:px-3",
                here && "bg-secondary",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border text-[0.625rem] tabular-nums",
                    record && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {record ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                <span className="truncate sm:hidden">{step.short}</span>
                <span className="hidden truncate sm:inline">{step.label}</span>
              </span>
              {!record ? (
                <span className="text-muted-foreground">Not made yet</span>
              ) : here ? (
                <span aria-current="page" className="font-medium break-words">
                  <Breakable number={record.number} />
                </span>
              ) : (
                <Link
                  href={hrefOf(step.key, record.id)}
                  className="font-medium break-words text-primary underline-offset-4 hover:underline"
                >
                  <Breakable number={record.number} />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
