import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import {
  type ProgressStep,
  readOrderStatus,
  type StyleProgress,
} from "@/modules/sales/order-status.service";

export const dynamic = "force-dynamic";
// The link is the key: never sent on to another site, never kept by a search engine.
export const metadata: Metadata = {
  title: { absolute: "Order status" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const count = (value: number) => value.toLocaleString("en-US");

const STATE_WORDS: Record<ProgressStep["state"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

function Step({ label, step, of }: { label: string; step: ProgressStep; of: number }) {
  const percent =
    step.percent ?? (step.state === "DONE" ? 100 : step.state === "NOT_STARTED" ? 0 : null);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-right text-muted-foreground tabular-nums">
          {step.pieces !== null
            ? `${count(step.pieces)} of ${count(of)} pcs${step.percent !== null ? ` · ${step.percent}%` : ""}`
            : STATE_WORDS[step.state]}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={STATE_WORDS[step.state]}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            step.state === "DONE" ? "bg-primary" : "bg-primary/60",
            percent === null && "w-1/2 animate-pulse bg-primary/30",
          )}
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}

function StyleCard({ style }: { style: StyleProgress }) {
  const p = style.production;
  return (
    <section
      className="min-w-0 rounded-lg border bg-card p-5"
      aria-label={style.code || style.name}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 font-medium break-words">
          {style.code ? `${style.code} · ${style.name}` : style.name}
        </h2>
        {style.pieces > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {count(style.pieces)} pcs ordered
          </p>
        )}
      </div>
      {p ? (
        <>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Now at: {p.stage} · {count(p.target)} pcs in production
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Step label="Cutting" step={p.cutting} of={p.target} />
            <Step label="Sewing" step={p.sewing} of={p.target} />
            <Step label="Finishing" step={p.finishing} of={p.target} />
            <Step label="Packing" step={p.packing} of={p.target} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Production has not started yet.</p>
      )}
    </section>
  );
}

/**
 * The page a company shares with its buyer (Share order status on the order's
 * page): open without signing in, read-only, from a link that can end or be
 * stopped. It shows only the company's name and logo, the order number, its
 * styles and pieces, the cutting, sewing, finishing and packing progress and the
 * ship dates (modules/sales/order-status.service.ts readOrderStatus).
 */
export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await readOrderStatus(token);
  if (!view) notFound();
  const { company, order, styles } = view;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-12 sm:px-6 sm:pt-10">
      <header className="flex min-w-0 items-center gap-4 border-b pb-5">
        {company.logo && (
          // A data: address from the Company record; next/image cannot take one.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo}
            alt=""
            className="h-12 w-auto max-w-[8rem] shrink-0 object-contain"
          />
        )}
        <p className="min-w-0 font-serif text-xl leading-tight break-words text-primary sm:text-2xl">
          {company.name}
        </p>
      </header>

      <div className="mt-6">
        <p className="eyebrow">Order status</p>
        <h1 className="mt-2 font-serif text-[2rem] leading-tight break-words text-primary">
          {order.number}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {order.status} · ordered {formatDay(order.orderedOn)} · {count(order.pieces)} pcs
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 rounded-lg border bg-card p-5 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-[0.8125rem] text-muted-foreground">Planned ship date</dt>
          <dd className="mt-1 font-medium">
            {order.plannedShipOn ? formatDay(order.plannedShipOn) : "Not set yet"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.8125rem] text-muted-foreground">Shipped</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {count(order.shipped)} of {count(order.pieces)} pcs
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[0.8125rem] text-muted-foreground">Last shipped on</dt>
          <dd className="mt-1 font-medium">
            {order.shippedOn ? formatDay(order.shippedOn) : "Not shipped yet"}
          </dd>
        </div>
      </dl>

      <div className="mt-6 grid gap-4">
        {styles.map((style) => (
          <StyleCard key={`${style.code}-${style.name}`} style={style} />
        ))}
      </div>

      <p className="mt-8 text-[0.8125rem] text-muted-foreground">
        As of {formatDay(view.asOf)}. This page only shows progress; for anything else, contact{" "}
        {company.name}.
      </p>
    </main>
  );
}
