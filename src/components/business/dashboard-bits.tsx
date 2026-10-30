"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Amount } from "@/components/accounts/privacy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";

/*
 * The pieces every Business dashboard shares (plan v6 sec 10): the period at
 * the top, the big number cards compared with the period before (green for a
 * gain, red for a loss) and a simple two-colour bar chart. Every amount hides
 * behind the page's eye.
 */

const PERIOD_LABELS: Record<string, string> = {
  today: "Today",
  "7d": "Last 7 days",
  week: "This week",
  month: "This month",
  year: "This year",
  all: "Lifetime",
  custom: "Your own days",
};

/** The period in the address bar: ?period=..., or ?from=...&to=... for your own days. */
export function PeriodPicker({ period }: { period: { key: string; from: string; to: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(period.key === "custom");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  function go(next: Record<string, string | null>) {
    const search = new URLSearchParams(params.toString());
    for (const k of ["period", "from", "to"]) search.delete(k);
    for (const [k, v] of Object.entries(next)) if (v) search.set(k, v);
    const query = search.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    );
  }

  return (
    <div
      className={cn("flex flex-wrap items-end gap-3", pending && "opacity-70")}
      aria-busy={pending}
    >
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted-foreground">Period</span>
        <NativeSelect
          value={custom ? "custom" : period.key}
          containerClassName="sm:w-48"
          onChange={(e) => {
            const key = e.target.value;
            setCustom(key === "custom");
            if (key !== "custom") go({ period: key === "month" ? null : key });
          }}
        >
          {Object.entries(PERIOD_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      {custom && (
        <>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">From</span>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">To</span>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button type="button" variant="outline" onClick={() => go({ from, to })}>
            Show
          </Button>
        </>
      )}
    </div>
  );
}

/** "+ BDT 1,200.00 on the period before" in green, or the same in red for a fall. */
function Change({ change, currency }: { change: string; currency: string }) {
  const n = Number(change);
  if (n === 0) return <span className="text-muted-foreground">Same as the period before</span>;
  return (
    <span className={n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>
      {n > 0 ? "Up" : "Down"} {currency} {money(String(Math.abs(n)), currency)} on the period before
    </span>
  );
}

/** An amount grouped the way the company's currency is (BDT: 1,24,500.00), as on the PDFs. */
export const money = (v: string, currency: string) => groupAmount(Number(v).toFixed(2), currency);

/** One big figure: its label, the amount (red when below 0) and the change on the period before. */
export function BigCard({
  label,
  value,
  currency,
  change,
  hint,
  plain = false,
}: {
  label: string;
  value: string;
  currency: string;
  change?: string | null;
  hint?: React.ReactNode;
  /** A count or a percent, not money: shown as it is and never hidden. */
  plain?: boolean;
}) {
  const negative = Number(value) < 0;
  const shown = plain ? value : `${currency} ${money(value, currency)}`;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card p-4",
        negative && !plain && "border-destructive/40",
      )}
    >
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "mt-1 font-serif text-2xl leading-tight break-words lining-nums tabular-nums",
          negative ? "text-destructive" : "text-primary",
        )}
      >
        {plain ? shown : <Amount>{shown}</Amount>}
      </p>
      {(change !== undefined && change !== null) || hint ? (
        <p className="mt-1 text-[0.8125rem] break-words">
          {change !== undefined && change !== null && (
            <Amount>
              <Change change={change} currency={currency} />
            </Amount>
          )}
          {hint && <span className="block text-muted-foreground">{hint}</span>}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Two businesses in two colours, one pair of bars per day (or month). Bars
 * below the middle line are losses. The figures are in the table under it.
 */
export function ProfitChart({
  rows,
  currency,
  labels,
}: {
  rows: Array<{ bucket: string; erp: number; retail: number }>;
  currency: string;
  labels: { erp: string; retail: string };
}) {
  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">Nothing in this period yet.</p>;
  }
  const top = Math.max(1, ...rows.flatMap((r) => [r.erp, r.retail, 0]));
  const bottom = Math.min(0, ...rows.flatMap((r) => [r.erp, r.retail]));
  const H = 160;
  const scale = H / (top - bottom);
  const zero = top * scale;
  const W = Math.max(rows.length * 18, 200);
  const bar = (v: number) => ({
    y: v >= 0 ? zero - v * scale : zero,
    height: Math.max(1, Math.abs(v) * scale),
  });
  return (
    <figure className="mt-4 grid gap-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-primary" />
          {labels.erp}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm bg-amber-500" />
          {labels.retail}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`Profit by ${rows[0]!.bucket.length > 7 ? "day" : "month"}, in ${currency}`}
      >
        <line x1={0} x2={W} y1={zero} y2={zero} className="stroke-border" strokeWidth={1} />
        {rows.map((r, i) => {
          const x = (i * W) / rows.length;
          const w = W / rows.length / 2 - 1;
          return (
            <g key={r.bucket}>
              <rect x={x + 1} width={w} {...bar(r.erp)} className="fill-primary">
                <title>{`${r.bucket}: ${labels.erp} ${currency} ${r.erp}`}</title>
              </rect>
              <rect x={x + 1 + w} width={w} {...bar(r.retail)} className="fill-amber-500">
                <title>{`${r.bucket}: ${labels.retail} ${currency} ${r.retail}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <figcaption className="flex justify-between text-xs text-muted-foreground">
        <span>{rows[0]!.bucket}</span>
        <span>{rows[rows.length - 1]!.bucket}</span>
      </figcaption>
    </figure>
  );
}

/** A part that opens on a click, so the page stays calm. */
export function More({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border bg-card p-5 sm:p-6">
      <summary className="cursor-pointer font-serif text-xl text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25">
        {title}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
