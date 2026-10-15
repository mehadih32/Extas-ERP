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
import { type AiCosts, COST_PERIODS } from "@/modules/ai/costs.service";

/*
 * AI Center > Budget & Costs, the figures: the period's total, the month
 * against the budget and its projection, cost per day, the costliest calls,
 * the breakdowns and every line with its reason.
 */

const when = (at: Date | string, timeZone: string) =>
  new Date(at).toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function costsHref(query: Partial<AiCosts["query"]> & { period?: string }) {
  const params = new URLSearchParams();
  if (query.period && query.period !== "month") params.set("period", query.period);
  if (query.period === "custom") {
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
  }
  if (query.userId) params.set("person", query.userId);
  const text = params.toString();
  return text ? `/ai/costs?${text}` : "/ai/costs";
}

function Breakdown({
  title,
  id,
  rows,
  currency,
}: {
  title: string;
  id: string;
  rows: AiCosts["by"]["task"];
  currency: string;
}) {
  const top = Number(rows[0]?.cost ?? 0);
  return (
    <Panel title={title} id={id}>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing in this period.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {rows.slice(0, 10).map((r) => (
            <li key={r.key} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {r.href ? (
                  <Link href={r.href} className="min-w-0 break-words underline underline-offset-4">
                    {r.label}
                  </Link>
                ) : (
                  <span className="min-w-0 break-words">{r.label}</span>
                )}
                <span className="shrink-0 tabular-nums">{money(r.cost, currency)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary"
                    style={{ width: `${top > 0 ? Math.max(2, (Number(r.cost) / top) * 100) : 0}%` }}
                  />
                </div>
                <span className="w-16 text-right text-[0.75rem] text-muted-foreground">
                  {r.calls} {r.calls === 1 ? "call" : "calls"}
                </span>
              </div>
            </li>
          ))}
        </ul>
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
              {when(l.at, timeZone)} · {l.who} · {l.agent} · {l.model}
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
            <div className="font-medium">{money(l.cost, currency)}</div>
            <div className="text-[0.75rem] text-muted-foreground">
              ${l.costUsd} · {l.tokens.input.toLocaleString("en")} in /{" "}
              {l.tokens.output.toLocaleString("en")} out
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
    return `/api/ai/costs/export?${params}`;
  };

  return (
    <div className="grid gap-6">
      <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
        {COST_PERIODS.map((p) => (
          <Link
            key={p.value}
            href={costsHref({ ...c.query, period: p.value })}
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
          {c.query.period === "custom" && (
            <>
              <input type="hidden" name="from" value={c.query.from} />
              <input type="hidden" name="to" value={c.query.to} />
            </>
          )}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="By task" id="ai-cost-task-heading" rows={c.by.task} currency={cur} />
        <Breakdown title="By model" id="ai-cost-model-heading" rows={c.by.model} currency={cur} />
        <Breakdown title="By area" id="ai-cost-module-heading" rows={c.by.module} currency={cur} />
        <Breakdown title="By agent" id="ai-cost-agent-heading" rows={c.by.agent} currency={cur} />
        <Breakdown
          title="By person"
          id="ai-cost-person-heading"
          rows={c.by.person}
          currency={cur}
        />
        <Breakdown
          title="By order and tech pack"
          id="ai-cost-record-heading"
          rows={c.by.record}
          currency={cur}
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

      <Panel title="Every call" id="ai-cost-lines-heading">
        {c.lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {c.aiOn
              ? "No call to Claude in this period."
              : "AI is off, so nothing is spent. Every call to Claude shows here once it is on."}
          </p>
        ) : (
          <>
            <Lines lines={c.lines} currency={cur} timeZone={c.timeZone} />
            {c.totals.calls > c.lines.length && (
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                The newest 100 of {c.totals.calls} calls are shown; the Excel file has them all.
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
