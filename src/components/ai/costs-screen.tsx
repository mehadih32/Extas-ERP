import { DownloadIcon } from "lucide-react";
import Link from "next/link";

import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { type AiCosts, COST_PERIODS, type CostSlice } from "@/modules/ai/costs.service";

/*
 * AI Center > Budget & Costs, the figures: the period's total, the month
 * against the budget and its projection, cost per day, the costliest calls,
 * the breakdowns (each with its total; a row shows its own calls) and every
 * line with its reason and its place in the ERP.
 */

/** A breakdown's name, before the row picked ("Place: AI › Chat"). */
const SLICE_NAMES: Record<CostSlice, string> = {
  provider: "Provider",
  task: "Purpose",
  place: "Place",
  model: "Model",
  module: "Area",
  agent: "Agent",
  person: "Person",
  record: "Record",
};

const when = (at: Date | string, timeZone: string) =>
  new Date(at).toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

type CostsQuery = Partial<Omit<AiCosts["query"], "by" | "key" | "page">> & {
  period?: string;
  by?: CostSlice | null;
  key?: string | null;
  page?: number;
};

export function costsHref(query: CostsQuery) {
  const params = new URLSearchParams();
  if (query.period && query.period !== "month") params.set("period", query.period);
  if (query.period === "custom" || query.period === "day") {
    if (query.from) params.set("from", query.from);
  }
  if (query.period === "custom" && query.to) params.set("to", query.to);
  if (query.userId) params.set("person", query.userId);
  if (query.by && query.key != null) {
    params.set("by", query.by);
    params.set("key", query.key);
  }
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `/ai/costs?${text}` : "/ai/costs";
}

/** The same period and person, with only one row's calls listed. */
const sliceHref = (c: AiCosts, by: CostSlice, key: string) =>
  `${costsHref({ ...c.query, by, key, page: 1 })}#ai-cost-lines-heading`;

const calls = (n: number) => `${n} ${n === 1 ? "call" : "calls"}`;

function BreakdownRow({
  c,
  by,
  row: r,
  top,
}: {
  c: AiCosts;
  by: CostSlice;
  row: AiCosts["by"]["task"][number];
  top: number;
}) {
  const picked = c.query.by === by && c.query.key === r.key;
  return (
    <li className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words">
          <Link
            href={sliceHref(c, by, r.key)}
            aria-current={picked ? "true" : undefined}
            className={cn("underline-offset-4 hover:underline", picked && "font-medium underline")}
          >
            {r.label}
          </Link>
          {r.href && (
            <Link
              href={r.href}
              className="ml-2 text-[0.75rem] text-muted-foreground underline underline-offset-4"
            >
              Open
            </Link>
          )}
        </span>
        <span className="shrink-0 tabular-nums">{money(r.cost, c.currency)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-primary"
            style={{ width: `${top > 0 ? Math.max(2, (Number(r.cost) / top) * 100) : 0}%` }}
          />
        </div>
        <span className="w-16 text-right text-[0.75rem] text-muted-foreground">
          {calls(r.calls)}
        </span>
      </div>
    </li>
  );
}

function Breakdown({
  c,
  by,
  title,
  id,
  rows,
  note,
}: {
  c: AiCosts;
  by: CostSlice;
  title: string;
  id: string;
  rows: AiCosts["by"]["task"];
  note?: string;
}) {
  const top = Number(rows[0]?.cost ?? 0);
  const total = rows.reduce((t, r) => t + Number(r.cost), 0);
  const totalCalls = rows.reduce((t, r) => t + r.calls, 0);
  return (
    <Panel title={title} id={id}>
      {note && <p className="mt-1 text-[0.8125rem] text-muted-foreground">{note}</p>}
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing in this period.</p>
      ) : (
        <>
          <ul className="mt-3 grid gap-2">
            {rows.slice(0, 10).map((r) => (
              <BreakdownRow key={r.key} c={c} by={by} row={r} top={top} />
            ))}
          </ul>
          {rows.length > 10 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[0.8125rem] text-muted-foreground">
                Show all {rows.length}
              </summary>
              <ul className="mt-2 grid gap-2">
                {rows.slice(10).map((r) => (
                  <BreakdownRow key={r.key} c={c} by={by} row={r} top={top} />
                ))}
              </ul>
            </details>
          )}
          <p className="mt-3 flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-medium">
            <span>Total</span>
            <span className="tabular-nums">
              {money(total.toFixed(2), c.currency)}{" "}
              <span className="text-[0.75rem] font-normal text-muted-foreground">
                {calls(totalCalls)}
              </span>
            </span>
          </p>
        </>
      )}
    </Panel>
  );
}

function Lines({
  lines,
  currency,
  timeZone,
}: {
  lines: AiCosts["lines"];
  currency: string;
  timeZone: string;
}) {
  return (
    <ul className="mt-3 divide-y">
      {lines.map((l) => (
        <li key={l.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-sm font-medium break-words">
              {l.task}
              {l.result !== "OK" && (
                <StatusBadge tone={l.result === "FAILED" ? "warn" : "closed"} className="ml-2">
                  {l.result === "FAILED" ? "Failed" : "Stopped"}
                </StatusBadge>
              )}
            </span>
            <span className="text-[0.8125rem] break-words">{l.why}</span>
            <span className="text-[0.8125rem] text-muted-foreground">
              {when(l.at, timeZone)} · {l.who} · {l.agent} · {l.model} ·{" "}
              {l.place.href ? (
                <Link href={l.place.href} className="underline underline-offset-4">
                  {l.place.label}
                </Link>
              ) : (
                l.place.label
              )}
              {l.record && (
                <>
                  {" · "}
                  {l.href ? (
                    <Link href={l.href} className="underline underline-offset-4">
                      {l.record}
                    </Link>
                  ) : (
                    l.record
                  )}
                </>
              )}
            </span>
            {l.note && <span className="text-[0.8125rem] text-muted-foreground">{l.note}</span>}
          </div>
          <div className="text-sm tabular-nums sm:text-right">
            <div className="font-medium">
              {l.costKnown ? money(l.cost, currency) : "Price unknown"}
            </div>
            <div className="text-[0.75rem] text-muted-foreground">
              {l.costKnown ? `$${l.costUsd}` : l.provider} · {l.tokens.input.toLocaleString("en")}{" "}
              in / {l.tokens.output.toLocaleString("en")} out
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CostsScreen({ costs: c }: { costs: AiCosts }) {
  const cur = c.currency;
  const peak = Math.max(...c.perDay.map((d) => Number(d.cost)), 0);
  const exportHref = (format: "pdf" | "xlsx") => {
    const params = new URLSearchParams({
      period: c.query.period,
      from: c.query.from,
      to: c.query.to,
      format,
    });
    if (c.query.userId) params.set("person", c.query.userId);
    if (c.query.by && c.query.key !== null) {
      params.set("by", c.query.by);
      params.set("key", c.query.key);
    }
    return `/api/ai/costs/export?${params}`;
  };

  return (
    <div className="grid gap-6">
      <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
        {COST_PERIODS.map((p) => (
          <Link
            key={p.value}
            href={costsHref({ ...c.query, period: p.value, page: 1 })}
            aria-current={c.query.period === p.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-[0.8125rem]",
              c.query.period === p.value
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card",
            )}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      {c.query.period === "day" && (
        <form action="/ai/costs" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="period" value="day" />
          {c.query.userId && <input type="hidden" name="person" value={c.query.userId} />}
          <Field id="costs-day" label="Day">
            <Input id="costs-day" type="date" name="from" defaultValue={c.query.from} required />
          </Field>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      )}

      {c.query.period === "custom" && (
        <form action="/ai/costs" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="period" value="custom" />
          {c.query.userId && <input type="hidden" name="person" value={c.query.userId} />}
          <Field id="costs-from" label="From">
            <Input id="costs-from" type="date" name="from" defaultValue={c.query.from} required />
          </Field>
          <Field id="costs-to" label="To">
            <Input id="costs-to" type="date" name="to" defaultValue={c.query.to} required />
          </Field>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      )}

      {c.people.length > 0 && (
        <form action="/ai/costs" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="period" value={c.query.period} />
          {(c.query.period === "custom" || c.query.period === "day") && (
            <input type="hidden" name="from" value={c.query.from} />
          )}
          {c.query.period === "custom" && <input type="hidden" name="to" value={c.query.to} />}
          <Field id="costs-person" label="Person">
            <NativeSelect id="costs-person" name="person" defaultValue={c.query.userId ?? ""}>
              <option value="">Everyone</option>
              {c.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>
      )}

      {c.month.budget && c.month.percent !== null && c.month.percent >= c.month.alertPercent && (
        <FormAlert tone={c.month.percent >= 100 ? "error" : "note"}>
          The AI has used {c.month.percent}% of this month&apos;s budget (
          {money(c.month.spent, cur)} of {money(c.month.budget, cur)}).
        </FormAlert>
      )}

      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: `Spent (${formatDay(c.query.from)}${c.query.to !== c.query.from ? ` to ${formatDay(c.query.to)}` : ""})`,
            value: money(c.totals.cost, cur),
            hint: `$${c.totals.costUsd} · ${c.totals.calls} ${c.totals.calls === 1 ? "call" : "calls"}`,
          },
          {
            label: "This month",
            value: money(c.month.spent, cur),
            hint: c.month.budget
              ? `of ${money(c.month.budget, cur)} budget (${c.month.percent}%)`
              : "No monthly budget set",
          },
          {
            label: "Month-end at this pace",
            value: money(c.month.projection, cur),
            hint: "If the rest of the month goes like it has so far",
          },
          {
            label: "Failed or stopped",
            value: String(c.totals.failed + c.totals.stopped),
            hint: "Failed calls cost nothing; stopped ones were not sent",
          },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border bg-card p-4">
            <p className="text-[0.8125rem] text-muted-foreground">{f.label}</p>
            <p className="mt-1 font-serif text-2xl text-primary tabular-nums">{f.value}</p>
            <p className="mt-1 text-[0.75rem] text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </section>

      <Panel
        title="Cost per day"
        id="ai-cost-days-heading"
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href={exportHref("pdf")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[0.8125rem]"
            >
              <DownloadIcon aria-hidden className="size-3.5" />
              PDF
            </a>
            <a
              href={exportHref("xlsx")}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[0.8125rem]"
            >
              <DownloadIcon aria-hidden className="size-3.5" />
              Excel
            </a>
          </div>
        }
      >
        {peak === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No AI cost in this period.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <div
              className="flex h-40 min-w-full items-end gap-1"
              style={{ minWidth: `${c.perDay.length * 14}px` }}
              role="img"
              aria-label="Cost per day"
            >
              {c.perDay.map((d) => (
                <div
                  key={d.day}
                  title={`${formatDay(d.day)}: ${money(d.cost, cur)}`}
                  className="flex-1 rounded-t bg-primary/80"
                  style={{
                    height: `${Math.max(Number(d.cost) > 0 ? 2 : 0, (Number(d.cost) / peak) * 100)}%`,
                  }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[0.75rem] text-muted-foreground">
              <span>{formatDay(c.perDay[0]!.day)}</span>
              <span>{formatDay(c.perDay.at(-1)!.day)}</span>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Top 5 costliest calls" id="ai-cost-top-heading">
        {c.top.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing in this period.</p>
        ) : (
          <Lines lines={c.top} currency={cur} timeZone={c.timeZone} />
        )}
      </Panel>

      <Panel title="Bill per provider" id="ai-cost-provider-heading">
        <ul className="mt-3 divide-y">
          {c.by.provider.map((p) => (
            <li
              key={p.key}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
            >
              <Link
                href={sliceHref(c, "provider", p.key)}
                className="font-medium underline-offset-4 hover:underline"
              >
                {p.label}
              </Link>
              <span className="text-right tabular-nums">
                {money(p.cost, cur)}
                <span className="block text-[0.75rem] text-muted-foreground">
                  {p.calls} {p.calls === 1 ? "call" : "calls"}
                  {p.priceUnknown > 0 ? `, ${p.priceUnknown} with the price unknown` : ""}
                  {p.limit ? ` · limit ${money(p.limit, cur)} a month` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {c.totals.priceUnknown > 0 && (
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            Calls on a model with the price unknown are not in these totals: set its price on AI
            Center &gt; Models.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          c={c}
          by="task"
          title="By purpose"
          id="ai-cost-task-heading"
          rows={c.by.task}
          note="What the AI was asked to do."
        />
        <Breakdown
          c={c}
          by="place"
          title="By place in the ERP"
          id="ai-cost-place-heading"
          rows={c.by.place}
          note="The screen it was asked on, or the page of the record it was about."
        />
        <Breakdown c={c} by="model" title="By model" id="ai-cost-model-heading" rows={c.by.model} />
        <Breakdown c={c} by="agent" title="By agent" id="ai-cost-agent-heading" rows={c.by.agent} />
        <Breakdown
          c={c}
          by="module"
          title="By area"
          id="ai-cost-module-heading"
          rows={c.by.module}
        />
        <Breakdown
          c={c}
          by="person"
          title="By person"
          id="ai-cost-person-heading"
          rows={c.by.person}
        />
        <Breakdown
          c={c}
          by="record"
          title="By order and tech pack"
          id="ai-cost-record-heading"
          rows={c.by.record}
          note="Only the calls about one record."
        />
      </div>

      {c.stores.length > 0 && (
        <Panel title="By store" id="ai-cost-store-heading">
          <ul className="mt-3 divide-y">
            {c.stores.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span>
                  {s.name}
                  {s.here && <span className="text-muted-foreground"> (this one)</span>}
                </span>
                <span className="tabular-nums">
                  {money(s.cost, s.currency)}{" "}
                  <span className="text-[0.75rem] text-muted-foreground">
                    {s.calls} {s.calls === 1 ? "call" : "calls"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={c.shown.filter ? "Calls of one row" : "Every call"} id="ai-cost-lines-heading">
        {c.shown.filter && (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span>
              {SLICE_NAMES[c.shown.filter.by]}: <strong>{c.shown.filter.label}</strong> ·{" "}
              {money(c.shown.cost, cur)} · {calls(c.shown.calls)}
              {c.shown.priceUnknown > 0 ? `, ${c.shown.priceUnknown} with the price unknown` : ""}
            </span>
            <Link
              href={`${costsHref({ ...c.query, by: null, key: null, page: 1 })}#ai-cost-lines-heading`}
              className="text-[0.8125rem] underline underline-offset-4"
            >
              Show every call
            </Link>
          </div>
        )}
        {c.lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {c.aiOn
              ? "No AI call in this period."
              : "AI is off, so nothing is spent. Every AI call shows here once it is on."}
          </p>
        ) : (
          <>
            <Lines lines={c.lines} currency={cur} timeZone={c.timeZone} />
            {c.shown.pages > 1 && (
              <nav
                aria-label="Pages of calls"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]"
              >
                <span className="text-muted-foreground">
                  Page {c.shown.page} of {c.shown.pages} ({calls(c.shown.calls)}, newest first)
                </span>
                <span className="flex gap-2">
                  {c.shown.page > 1 && (
                    <Link
                      href={`${costsHref({ ...c.query, page: c.shown.page - 1 })}#ai-cost-lines-heading`}
                      className="rounded-md border px-2.5 py-1"
                    >
                      Newer
                    </Link>
                  )}
                  {c.shown.page < c.shown.pages && (
                    <Link
                      href={`${costsHref({ ...c.query, page: c.shown.page + 1 })}#ai-cost-lines-heading`}
                      className="rounded-md border px-2.5 py-1"
                    >
                      Older
                    </Link>
                  )}
                </span>
              </nav>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
