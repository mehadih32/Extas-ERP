import { Swatch } from "@/components/products/bits";
import { cn } from "@/lib/utils";

import { isZero, money } from "./labels";

/*
 * Building blocks for the Sales record pages (quotation, proforma, order,
 * invoice, receipt): panels, labelled facts, totals and size breakdowns.
 */

export function Panel({
  title,
  id,
  children,
  className,
  action,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
  className?: string;
  /** A button or link beside the heading. */
  action?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("min-w-0 rounded-lg border bg-card p-5 sm:p-6", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={id} className="font-serif text-xl text-primary">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

/** One line of a totals block: "Discount  − BDT 500.00". */
export type TotalLine = {
  label: string;
  amount: string;
  /** Taken off the total (shown with a minus). */
  minus?: boolean;
  /** The total itself, or what is still due: stronger. */
  strong?: boolean;
  tone?: "due" | "muted";
  /** Left out when zero. */
  optional?: boolean;
};

/** Subtotal, discount, charges, total and what is paid and due, right-aligned. */
export function Totals({
  lines,
  currency,
  className,
}: {
  lines: TotalLine[];
  currency: string;
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-2 text-sm tabular-nums", className)}>
      {lines
        .filter((line) => !(line.optional && isZero(line.amount)))
        .map((line, index) => (
          <div
            key={line.label}
            className={cn(
              "flex items-baseline justify-between gap-4",
              line.strong && "font-medium",
              line.strong && index > 0 && "border-t pt-2",
            )}
          >
            <dt className={cn(!line.strong && "text-muted-foreground")}>{line.label}</dt>
            <dd
              className={cn(
                "text-right whitespace-nowrap",
                line.strong && "font-serif text-lg",
                line.tone === "due" && !isZero(line.amount) && "text-destructive",
                line.tone === "muted" && "text-muted-foreground",
              )}
            >
              {line.minus && !isZero(line.amount) ? "− " : ""}
              {money(line.amount, currency)}
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** "S 20 · M 40 · L 40" as small chips. */
export function SizeChips({ sizes }: { sizes: Array<{ size: string; quantity: number }> }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sizes">
      {sizes.map((s) => (
        <li
          key={s.size}
          className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-[0.75rem] tabular-nums"
        >
          <span className="text-muted-foreground">{s.size}</span> {s.quantity}
        </li>
      ))}
    </ul>
  );
}

/** A colour's swatch and name. */
export function ColorName({ name, hexCode }: { name: string; hexCode: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Swatch hex={hexCode} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A heading block for a record page: what it is, who it is for, its badges. */
export function RecordHeader({
  eyebrow,
  title,
  badges,
  children,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  badges?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-2 font-serif text-[1.75rem] leading-tight break-words text-primary">
        {title}
      </h2>
      {badges && <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>}
      {children}
    </div>
  );
}
