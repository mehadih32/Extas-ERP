"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_POINTS, type Garment, MAX_POINTS } from "@/modules/inventory/size-chart-points";

/*
 * The size chart table: a row per measurement (Chest, Waist…), a column per
 * size, each cell the measurement in inches or cm, the other unit shown under
 * it. Used on the style's page and when a style is added from "Buy ready stock".
 */

export type ChartValue = {
  garment: Garment;
  unit: "INCH" | "CM";
  /** Values as typed, by size id. */
  points: Array<{ name: string; values: Record<string, string> }>;
};

export const GARMENT_LABELS: Record<Garment, string> = {
  TOP: "Top (shirt, polo, T-shirt)",
  BOTTOM: "Bottom (pant, trouser, shorts)",
  OTHER: "Other",
};

/** A new chart for a garment: its usual measurements, nothing filled. */
export function startChart(garment: Garment = "TOP", unit: "INCH" | "CM" = "INCH"): ChartValue {
  return { garment, unit, points: DEFAULT_POINTS[garment].map((name) => ({ name, values: {} })) };
}

/** The chart as the server takes it (empty cells left out). */
export function chartInput(chart: ChartValue) {
  return {
    garment: chart.garment,
    unit: chart.unit,
    points: chart.points
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        values: Object.fromEntries(Object.entries(p.values).filter(([, v]) => v.trim() !== "")),
      })),
  };
}

/** "38" in inches -> "96.5 cm" (and back). */
function other(value: string, unit: "INCH" | "CM") {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return "";
  return unit === "INCH" ? `${(n * 2.54).toFixed(1)} cm` : `${(n / 2.54).toFixed(1)} in`;
}

export function SizeChartEditor({
  idPrefix,
  sizes,
  value,
  onChange,
  error,
}: {
  idPrefix: string;
  sizes: ReadonlyArray<{ id: string; name: string }>;
  value: ChartValue;
  onChange: (next: ChartValue) => void;
  error?: string;
}) {
  const filled = value.points.some((p) => Object.values(p.values).some((v) => v.trim()));
  const setPoint = (i: number, point: ChartValue["points"][number]) =>
    onChange({ ...value, points: value.points.map((p, j) => (j === i ? point : p)) });

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor={`${idPrefix}-garment`}>
          Garment
          <NativeSelect
            id={`${idPrefix}-garment`}
            value={value.garment}
            containerClassName="sm:w-full"
            onChange={(e) => {
              const garment = e.target.value as Garment;
              // Nothing typed yet: start with the new garment's measurements.
              onChange(
                filled ? { ...value, garment } : { ...startChart(garment, value.unit), garment },
              );
            }}
          >
            {(Object.keys(GARMENT_LABELS) as Garment[]).map((g) => (
              <option key={g} value={g}>
                {GARMENT_LABELS[g]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor={`${idPrefix}-unit`}>
          Unit
          <NativeSelect
            id={`${idPrefix}-unit`}
            value={value.unit}
            containerClassName="sm:w-full"
            onChange={(e) => onChange({ ...value, unit: e.target.value as "INCH" | "CM" })}
          >
            <option value="INCH">Inches</option>
            <option value="CM">Centimetres</option>
          </NativeSelect>
        </label>
      </div>
      {sizes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Pick the sizes first: a column comes for each.
        </p>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm" aria-label="Size chart">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-2 py-2 font-medium">
                  Measurement
                </th>
                {sizes.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-2 text-center font-medium">
                    {s.name}
                  </th>
                ))}
                <th scope="col" className="w-10 px-1">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {value.points.map((p, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="px-2 py-1.5">
                    <Input
                      value={p.name}
                      maxLength={40}
                      className="min-w-32"
                      aria-label={`Measurement ${i + 1}`}
                      onChange={(e) => setPoint(i, { ...p, name: e.target.value })}
                    />
                  </td>
                  {sizes.map((s) => (
                    <td key={s.id} className="px-1 py-1.5">
                      <Input
                        value={p.values[s.id] ?? ""}
                        inputMode="decimal"
                        className="w-20 text-center"
                        aria-label={`${p.name || "Measurement"} for ${s.name}`}
                        onChange={(e) =>
                          setPoint(i, { ...p, values: { ...p.values, [s.id]: e.target.value } })
                        }
                      />
                      <span className="mt-0.5 block text-center text-xs text-muted-foreground">
                        {other(p.values[s.id] ?? "", value.unit)}
                      </span>
                    </td>
                  ))}
                  <td className="px-1 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${p.name || "this measurement"}`}
                      onClick={() =>
                        onChange({ ...value, points: value.points.filter((_, j) => j !== i) })
                      }
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {value.points.length < MAX_POINTS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            onChange({ ...value, points: [...value.points, { name: "", values: {} }] })
          }
        >
          <PlusIcon aria-hidden />
          Add a measurement
        </Button>
      )}
    </div>
  );
}
