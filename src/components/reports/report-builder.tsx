"use client";

import type { ReportFormat } from "@prisma/client";
import { EyeIcon, FileSpreadsheetIcon, FileTextIcon, LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { PeriodPreset } from "@/modules/accounts/periods";
import type { ReportMetricKey } from "@/modules/reports/catalog";
import { generateReportAction } from "@/server/actions/reports.actions";

import { builderQuery, builderSearch, type BuilderView, reportsHref } from "./labels";

type Metric = { key: ReportMetricKey; label: string; description: string };
type Period = { key: PeriodPreset | "CUSTOM"; label: string };
type Defaults = {
  title: string;
  period: PeriodPreset;
  metrics: ReportMetricKey[];
  topLimit: number;
  alertLimit: number;
  slowDays: number;
  coverDays: number;
};

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const number = (form: FormData, name: string) => {
  const value = text(form, name);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
};

/**
 * The Report Builder's choices: a title, the period (a quick choice or two
 * dates), the figures, and how long its lists are. "Show on screen" reloads the
 * page with the report below (kept in the address bar); "Make PDF" and "Make
 * Excel" make the file, keep it with the saved reports and open its page.
 */
export function ReportBuilder({
  view,
  metrics,
  periods,
  defaults,
  today,
  children,
}: {
  view: BuilderView;
  metrics: Metric[];
  periods: Period[];
  defaults: Defaults;
  today: string;
  /** The report on screen, dimmed while the next one loads. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [showing, startShowing] = useTransition();
  const [making, startMaking] = useTransition();
  const [format, setFormat] = useState<ReportFormat>();
  const [period, setPeriod] = useState<Period["key"]>(view.period ?? defaults.period);
  const available = new Set(metrics.map((m) => m.key));
  const [picked, setPicked] = useState<ReadonlySet<ReportMetricKey>>(
    new Set((view.metrics ?? defaults.metrics).filter((key) => available.has(key))),
  );
  const [error, setError] = useState<ActionError>();
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const general =
    error && error.code !== "INTERNAL" && !(error.code === "VALIDATION" && error.fieldErrors)
      ? error.message
      : undefined;
  const busy = showing || making;

  /** The choices on the form, or what is wrong with them. */
  function read(form: HTMLFormElement): Omit<BuilderView, "show"> | ActionError {
    const data = new FormData(form);
    const problems: Record<string, string[]> = {};
    const chosen = metrics.filter((m) => picked.has(m.key)).map((m) => m.key);
    if (chosen.length === 0) problems.metrics = ["Pick at least one figure."];
    const custom = period === "CUSTOM";
    const from = custom ? text(data, "from") || undefined : undefined;
    const to = custom ? text(data, "to") || undefined : undefined;
    if (custom && !from) problems.from = ["Choose the first day."];
    if (from && to && from > to) problems.to = ["The last day comes before the first."];
    if (Object.keys(problems).length > 0) {
      return {
        code: "VALIDATION",
        message: "Please check the highlighted fields.",
        fieldErrors: problems,
      };
    }
    const title = text(data, "title");
    return {
      title: title && title !== defaults.title ? title : undefined,
      period,
      from,
      to,
      // Everything this person may see is the default: no need to list it.
      metrics: chosen.length === metrics.length ? undefined : chosen,
      topLimit: picked.has("TOP_SELLERS") ? number(data, "topLimit") : undefined,
      alertLimit: picked.has("STOCK_ALERTS") ? number(data, "alertLimit") : undefined,
      slowDays: picked.has("STOCK_ALERTS") ? number(data, "slowDays") : undefined,
      coverDays: picked.has("STOCK_ALERTS") ? number(data, "coverDays") : undefined,
    };
  }

  function show(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const choices = read(event.currentTarget);
    if ("code" in choices) {
      setError(choices);
      return;
    }
    setError(undefined);
    startShowing(() => {
      router.push(reportsHref.builder(builderSearch({ ...choices, show: true })), {
        scroll: false,
      });
    });
  }

  function make(form: HTMLFormElement | null, kind: ReportFormat) {
    if (!form) return;
    const choices = read(form);
    if ("code" in choices) {
      setError(choices);
      return;
    }
    setError(undefined);
    setFormat(kind);
    startMaking(async () => {
      const result = await generateReportAction({
        ...builderQuery({ ...choices, metrics: choices.metrics ?? [...picked] }),
        format: kind,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${reportsHref.report(result.data.id)}?made=1`);
    });
  }

  function toggle(key: ReportMetricKey, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const withTop = picked.has("TOP_SELLERS");
  const withStock = picked.has("STOCK_ALERTS");

  return (
    <div className="grid grid-cols-1 gap-8">
      <form
        onSubmit={show}
        noValidate
        aria-label="Report choices"
        className="grid min-w-0 grid-cols-1 gap-6 rounded-lg border bg-card p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field id="report-title" label="Title" error={fieldError("title")}>
            <Input
              id="report-title"
              name="title"
              defaultValue={view.title ?? defaults.title}
              maxLength={80}
              aria-invalid={Boolean(fieldError("title"))}
            />
          </Field>
          <Field id="report-period" label="Period" error={fieldError("period")}>
            <NativeSelect
              id="report-period"
              name="period"
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period["key"])}
              containerClassName="sm:w-full"
            >
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {period === "CUSTOM" && (
            <>
              <Field id="report-from" label="From" error={fieldError("from")}>
                <Input
                  id="report-from"
                  name="from"
                  type="date"
                  max={today}
                  defaultValue={view.from ?? ""}
                  aria-invalid={Boolean(fieldError("from"))}
                />
              </Field>
              <Field
                id="report-to"
                label="To"
                hint="Leave empty for up to today."
                error={fieldError("to")}
              >
                <Input
                  id="report-to"
                  name="to"
                  type="date"
                  defaultValue={view.to ?? ""}
                  aria-invalid={Boolean(fieldError("to"))}
                />
              </Field>
            </>
          )}
        </div>

        <fieldset className="grid min-w-0 gap-3">
          <legend className="text-sm font-medium">Figures</legend>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {metrics.map((m) => (
              <li key={m.key} className="min-w-0">
                <label
                  className={cn(
                    "flex h-full cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    picked.has(m.key) ? "border-primary/40 bg-secondary/60" : "hover:bg-muted/50",
                  )}
                >
                  <input
                    type="checkbox"
                    name="metrics"
                    value={m.key}
                    checked={picked.has(m.key)}
                    onChange={(event) => toggle(m.key, event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                      {m.description}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {fieldError("metrics") && (
            <p className="text-[0.8125rem] text-destructive">{fieldError("metrics")}</p>
          )}
        </fieldset>

        {(withTop || withStock) && (
          <details className="group rounded-md border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">
              How long the lists are
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
              {withTop && (
                <Field
                  id="report-top"
                  label="Top sellers to list"
                  hint="5 to 100"
                  error={fieldError("topLimit")}
                >
                  <Input
                    id="report-top"
                    name="topLimit"
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={100}
                    defaultValue={view.topLimit ?? defaults.topLimit}
                  />
                </Field>
              )}
              {withStock && (
                <>
                  <Field
                    id="report-alerts"
                    label="Items in each stock alert"
                    hint="5 to 200"
                    error={fieldError("alertLimit")}
                  >
                    <Input
                      id="report-alerts"
                      name="alertLimit"
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={200}
                      defaultValue={view.alertLimit ?? defaults.alertLimit}
                    />
                  </Field>
                  <Field
                    id="report-slow"
                    label="Slow stock: sales over the last (days)"
                    hint="14 to 365"
                    error={fieldError("slowDays")}
                  >
                    <Input
                      id="report-slow"
                      name="slowDays"
                      type="number"
                      inputMode="numeric"
                      min={14}
                      max={365}
                      defaultValue={view.slowDays ?? defaults.slowDays}
                    />
                  </Field>
                  <Field
                    id="report-cover"
                    label="Slow when stock lasts more than (days)"
                    hint="30 to 730"
                    error={fieldError("coverDays")}
                  >
                    <Input
                      id="report-cover"
                      name="coverDays"
                      type="number"
                      inputMode="numeric"
                      min={30}
                      max={730}
                      defaultValue={view.coverDays ?? defaults.coverDays}
                    />
                  </Field>
                </>
              )}
            </div>
          </details>
        )}

        {general && <FormAlert>{general}</FormAlert>}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" variant="outline" disabled={busy} className="w-full sm:w-auto">
            {showing ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <EyeIcon aria-hidden />
            )}
            {showing ? "Loading" : "Show on screen"}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="w-full sm:w-auto"
            onClick={(event) => make(event.currentTarget.form, "PDF")}
          >
            {making && format === "PDF" ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <FileTextIcon aria-hidden />
            )}
            {making && format === "PDF" ? "Making the PDF" : "Make PDF"}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="w-full sm:w-auto"
            onClick={(event) => make(event.currentTarget.form, "EXCEL")}
          >
            {making && format === "EXCEL" ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheetIcon aria-hidden />
            )}
            {making && format === "EXCEL" ? "Making the Excel file" : "Make Excel"}
          </Button>
        </div>
      </form>

      {children && (
        <div
          aria-busy={showing}
          className={cn(
            "grid min-w-0 grid-cols-1 transition-opacity",
            showing && "pointer-events-none opacity-50",
          )}
        >
          {children}
        </div>
      )}

      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not make the report"
          onClose={() => setError(undefined)}
        />
      )}
    </div>
  );
}
