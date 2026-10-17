"use client";

import {
  CheckIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  PlusIcon,
  RulerIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import {
  convertMeasure,
  inchText,
  ITEM_KINDS,
  ITEM_LABELS,
  type MeasureUnit,
  toleranceText,
} from "@/modules/production/measurements";
import type { TechPackScreen } from "@/modules/production/tech-pack-screen.service";
import {
  addMeasurementRowAction,
  confirmMeasurementRowAction,
  makeChartAction,
  removeMeasurementRowAction,
  setMeasurementAction,
} from "@/server/actions/tech-pack.actions";

import { CELL_TONE, type Signal, SignalMark } from "./signals";

/*
 * The measurement chart: made from the buyer's few points (chest at one size,
 * the grade and the length), every other point and size from the grading
 * rules. A value the buyer gave or a person typed or confirmed is green, a
 * rule-made one yellow, a missing one red. Tap a value to change it.
 */

const UNIT_LABEL: Record<MeasureUnit, string> = { INCH: "inch", CM: "cm" };

function show(value: number | null | undefined, unit: MeasureUnit, as: MeasureUnit) {
  if (value === null || value === undefined) return "–";
  const v = unit === as ? value : convertMeasure(value, unit);
  return as === "INCH" ? inchText(v) : v.toFixed(1).replace(/\.0$/, "");
}

type Chart = TechPackScreen["chart"];
type Suggestion = NonNullable<NonNullable<TechPackScreen["draft"]>["output"]["chart"]>;

export function ChartPanel({
  techPackId,
  chart,
  suggestion,
  canEdit,
}: {
  techPackId: string;
  chart: Chart;
  /** The buyer's points the AI draft read from their sheet, to start the form with. */
  suggestion: Suggestion | null;
  canEdit: boolean;
}) {
  const [asking, setAsking] = useState<
    | { kind: "make" }
    | { kind: "cell"; code: string; name: string; size: string; value: number | null }
    | { kind: "add" }
    | { kind: "remove"; code: string; name: string }
    | null
  >(null);
  const [as, setAs] = useState<MeasureUnit>(chart.unit);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const has = chart.rows.length > 0;
  const base = `/api/tech-packs/${techPackId}/measurements`;
  const start = {
    garmentKind: chart.garmentKind ?? (suggestion ? undefined : "POLO"),
    unit: chart.unit,
    sizes:
      chart.sizes.length > 0
        ? chart.sizes.join(", ")
        : (suggestion?.sizes?.join(", ") ?? "S, M, L, XL, 2XL, 3XL"),
    baseSize: chart.baseSize ?? suggestion?.baseSize ?? "S",
    chest:
      chart.rows.find((r) => r.code === "CHEST")?.values[chart.baseSize ?? ""] ??
      suggestion?.chest ??
      "",
    length:
      chart.rows.find((r) => r.code === "LENGTH")?.values[chart.baseSize ?? ""] ??
      suggestion?.length ??
      "",
    chestGrade: suggestion?.chestGrade ?? "",
  };

  const confirm = (code: string) =>
    startTransition(async () => {
      const result = await confirmMeasurementRowAction(techPackId, code);
      setError(result.ok ? undefined : result.error);
    });

  return (
    <Panel
      title="Measurements"
      id="tech-pack-chart-heading"
      action={
        has ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`${base}?format=pdf`}>
                <FileTextIcon aria-hidden />
                Measurement sheet
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`${base}?format=xlsx`}>
                <FileSpreadsheetIcon aria-hidden />
                Excel
              </a>
            </Button>
          </div>
        ) : null
      }
    >
      {!has ? (
        <div className="mt-3 grid gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            No chart yet. Give the buyer&apos;s few points (the chest at one size, the grade and the
            body length) and the full chart is made for every size, each made value yellow until
            someone confirms it.
          </p>
          {suggestion?.chest && (
            <FormAlert tone="note">
              The AI draft read the buyer&apos;s points: chest {suggestion.chest} at{" "}
              {suggestion.baseSize ?? "?"}. They fill the form.
            </FormAlert>
          )}
          {canEdit && (
            <p>
              <Button type="button" size="sm" onClick={() => setAsking({ kind: "make" })}>
                <RulerIcon aria-hidden />
                Make the chart
              </Button>
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.8125rem] text-muted-foreground">
              In {UNIT_LABEL[chart.unit]}
              {chart.chestBasis
                ? `, chest ${chart.chestBasis === "FULL" ? "full (round)" : "half"}`
                : ""}
              .{canEdit ? " Tap a value to change it." : ""}
            </p>
            <label className="flex items-center gap-2 text-[0.8125rem]">
              Show in
              <NativeSelect
                aria-label="Show in"
                value={as}
                onChange={(e) => setAs(e.target.value as MeasureUnit)}
                className="h-8 md:h-8"
              >
                <option value="INCH">inch</option>
                <option value="CM">cm</option>
              </NativeSelect>
            </label>
          </div>
          <div className="relative -mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-[0.8125rem] text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Point of measure
                  </th>
                  {chart.sizes.map((s) => (
                    <th key={s} scope="col" className="px-1.5 py-2 text-right font-medium">
                      {s}
                      {s === chart.baseSize && (
                        <span className="sr-only"> (the buyer&apos;s size)</span>
                      )}
                      {s === chart.baseSize && <span aria-hidden>*</span>}
                    </th>
                  ))}
                  <th scope="col" className="px-1.5 py-2 text-right font-medium">
                    Tol ±
                  </th>
                  {canEdit && (
                    <th scope="col" className="py-2 pl-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((r) => {
                  const ruled = chart.sizes.some(
                    (s) =>
                      r.sources[s] === "RULE" && r.values[s] !== null && r.values[s] !== undefined,
                  );
                  return (
                    <tr key={r.code} className="border-b last:border-b-0">
                      <th scope="row" className="max-w-56 py-2 pr-3 text-left font-normal">
                        <span className="font-medium">
                          {r.critical && (
                            <span title="Critical: checked on every piece" aria-label="Critical">
                              ★{" "}
                            </span>
                          )}
                          {r.name}
                        </span>
                        {r.rule && (
                          <span className="block text-[0.75rem] text-muted-foreground">
                            {r.rule}
                          </span>
                        )}
                      </th>
                      {chart.sizes.map((s) => {
                        const value = r.values[s];
                        const signal: Signal =
                          value === null || value === undefined
                            ? "red"
                            : r.sources[s] === "RULE"
                              ? "yellow"
                              : "green";
                        const text = show(value, chart.unit, as);
                        return (
                          <td key={s} className="px-0.5 py-1 text-right tabular-nums">
                            {canEdit ? (
                              <button
                                type="button"
                                className={cn(
                                  "w-full min-w-12 rounded px-1.5 py-1 text-right hover:ring-1 hover:ring-ring",
                                  CELL_TONE[signal],
                                )}
                                aria-label={`${r.name} at ${s}: ${text}. Change`}
                                onClick={() =>
                                  setAsking({
                                    kind: "cell",
                                    code: r.code,
                                    name: r.name,
                                    size: s,
                                    value: value ?? null,
                                  })
                                }
                              >
                                {text}
                              </button>
                            ) : (
                              <span className={cn("block rounded px-1.5 py-1", CELL_TONE[signal])}>
                                {text}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-1.5 py-1 text-right text-muted-foreground tabular-nums">
                        {as === chart.unit
                          ? toleranceText(r.tolerance, chart.unit)
                          : show(r.tolerance, chart.unit, as)}
                      </td>
                      {canEdit && (
                        <td className="py-1 pl-2 whitespace-nowrap">
                          {ruled && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => confirm(r.code)}
                              title="Confirm the yellow values of this row as they are"
                            >
                              <CheckIcon aria-hidden />
                              Confirm
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${r.name}`}
                            onClick={() =>
                              setAsking({ kind: "remove", code: r.code, name: r.name })
                            }
                          >
                            <Trash2Icon aria-hidden />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <SignalMark signal="green" /> The buyer&apos;s or confirmed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <SignalMark signal="yellow" /> Made by the grading rules
            </span>
            <span className="inline-flex items-center gap-1.5">
              <SignalMark signal="red" /> Missing
            </span>
            <span>* the buyer&apos;s size · ★ critical</span>
          </p>
          {chart.questions.length > 0 && (
            <FormAlert tone="note">
              <p className="font-medium">To settle with the buyer</p>
              <ul className="mt-1 grid list-disc gap-1 pl-4">
                {chart.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </FormAlert>
          )}
          {error && <FormAlert>{error.message}</FormAlert>}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAsking({ kind: "add" })}
              >
                <PlusIcon aria-hidden />
                Add a measurement
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAsking({ kind: "make" })}
              >
                <RulerIcon aria-hidden />
                Make the chart again
              </Button>
            </div>
          )}
        </div>
      )}

      {asking?.kind === "make" && (
        <FormDialog
          title="Make the chart from the buyer's points"
          description={
            has
              ? "The grading rules fill the chart again. Every value a person typed or confirmed stays as it is."
              : "Every other point and size is made from these by the grading rules, yellow until someone confirms it."
          }
          submitLabel="Make the chart"
          pendingLabel="Making"
          errorTitle="We could not make the chart"
          className="sm:max-w-xl"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await makeChartAction(techPackId, Object.fromEntries(form));
            if (!result.ok) return result.error;
            setAsking(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="chart-garment" label="Garment" error={fieldError("garmentKind")}>
                <NativeSelect
                  id="chart-garment"
                  name="garmentKind"
                  defaultValue={start.garmentKind}
                  containerClassName="sm:w-full"
                >
                  {ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ITEM_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="chart-unit" label="Unit" error={fieldError("unit")}>
                <NativeSelect
                  id="chart-unit"
                  name="unit"
                  defaultValue={start.unit}
                  containerClassName="sm:w-full"
                >
                  <option value="INCH">inch</option>
                  <option value="CM">cm</option>
                </NativeSelect>
              </Field>
              <Field
                id="chart-sizes"
                label="Sizes"
                hint="In order, e.g. S, M, L, XL, 2XL, 3XL"
                error={fieldError("sizes")}
                className="sm:col-span-2"
              >
                <Input id="chart-sizes" name="sizes" defaultValue={start.sizes} required />
              </Field>
              <Field
                id="chart-base"
                label="The buyer's size"
                hint="The size their points are for"
                error={fieldError("baseSize")}
              >
                <Input id="chart-base" name="baseSize" defaultValue={start.baseSize} required />
              </Field>
              <Field id="chart-chest" label="Chest at that size" error={fieldError("chest")}>
                <Input
                  id="chart-chest"
                  name="chest"
                  inputMode="decimal"
                  defaultValue={start.chest}
                  required
                />
              </Field>
              <Field
                id="chart-basis"
                label="Chest measured"
                hint="Not sure: the size of the number decides"
                error={fieldError("chestBasis")}
              >
                <NativeSelect
                  id="chart-basis"
                  name="chestBasis"
                  defaultValue={chart.chestBasis ?? "AUTO"}
                  containerClassName="sm:w-full"
                >
                  <option value="AUTO">Not sure</option>
                  <option value="FULL">Full (round)</option>
                  <option value="HALF">Half</option>
                </NativeSelect>
              </Field>
              <Field
                id="chart-grade"
                label="Chest grade per size"
                hint='Empty: 2" (5 cm) on the full chest'
                error={fieldError("chestGrade")}
              >
                <Input
                  id="chart-grade"
                  name="chestGrade"
                  inputMode="decimal"
                  defaultValue={start.chestGrade}
                />
              </Field>
              <Field
                id="chart-length"
                label="Body length at that size"
                hint="From the high point of the shoulder"
                error={fieldError("length")}
              >
                <Input
                  id="chart-length"
                  name="length"
                  inputMode="decimal"
                  defaultValue={start.length}
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {asking?.kind === "cell" && (
        <FormDialog
          title={`${asking.name} at ${asking.size}`}
          description={`In ${UNIT_LABEL[chart.unit]}. Saved as typed, so it turns green; leave it empty if it is not known (red).`}
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the measurement"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await setMeasurementAction(techPackId, {
              code: asking.code,
              size: asking.size,
              value: String(form.get("value") ?? "").trim(),
            });
            if (!result.ok) return result.error;
            setAsking(null);
          }}
        >
          {(fieldError) => (
            <Field
              id="cell-value"
              label={`Value (${UNIT_LABEL[chart.unit]})`}
              error={fieldError("value")}
            >
              <Input
                id="cell-value"
                name="value"
                inputMode="decimal"
                defaultValue={asking.value ?? ""}
                autoFocus
              />
            </Field>
          )}
        </FormDialog>
      )}

      {asking?.kind === "add" && (
        <FormDialog
          title="Add a measurement"
          description="A point the rules do not make (a pocket position, a label height). Its sizes start empty (red)."
          submitLabel="Add"
          pendingLabel="Adding"
          errorTitle="We could not add the measurement"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await addMeasurementRowAction(techPackId, {
              name: form.get("name"),
              howTo: form.get("howTo"),
              tolerance: form.get("tolerance") || undefined,
              critical: form.get("critical") === "on",
            });
            if (!result.ok) return result.error;
            setAsking(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="add-name" label="Point of measure" error={fieldError("name")}>
                <Input id="add-name" name="name" required />
              </Field>
              <Field id="add-how" label="How to measure" error={fieldError("howTo")}>
                <Input id="add-how" name="howTo" />
              </Field>
              <Field
                id="add-tol"
                label={`Tolerance ± (${UNIT_LABEL[chart.unit]})`}
                error={fieldError("tolerance")}
              >
                <Input
                  id="add-tol"
                  name="tolerance"
                  inputMode="decimal"
                  defaultValue={chart.unit === "INCH" ? "0.25" : "0.5"}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="critical" className="size-4" />
                Critical (checked on every piece)
              </label>
            </div>
          )}
        </FormDialog>
      )}

      {asking?.kind === "remove" && (
        <FormDialog
          title={`Remove ${asking.name}?`}
          description="It comes out of the chart. Making the chart again brings a rule-made point back."
          submitLabel="Remove"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the measurement"
          onClose={() => setAsking(null)}
          onSubmit={async () => {
            const result = await removeMeasurementRowAction(techPackId, asking.code);
            if (!result.ok) return result.error;
            setAsking(null);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </Panel>
  );
}
