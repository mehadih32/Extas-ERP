"use client";

import { RulerIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import type { SizeChartScreen } from "@/modules/inventory/size-chart.service";
import {
  saveSizeChartAction,
  sizeChartFromTechPackAction,
} from "@/server/actions/inventory.actions";

import { type ChartValue, chartInput, GARMENT_LABELS, SizeChartEditor } from "./size-chart-editor";

/*
 * A style's size chart on its page: what each size measures, in inches with cm
 * beside (or the other way), as the shops show it. "Edit size chart" changes
 * it; "Fill from the tech pack" copies the style's tech pack measurements in.
 */

const toEditor = (chart: Pick<SizeChartScreen, "garment" | "unit" | "points">): ChartValue => ({
  garment: chart.garment,
  unit: chart.unit,
  points: chart.points.map((p) => ({
    name: p.name,
    values: Object.fromEntries(
      Object.entries(p.values).flatMap(([k, v]) => (v === null ? [] : [[k, String(v)]])),
    ),
  })),
});

function other(value: number, unit: "INCH" | "CM") {
  return unit === "INCH" ? `${(value * 2.54).toFixed(1)} cm` : `${(value / 2.54).toFixed(1)} in`;
}

export function SizeChartPanel({ styleId, chart }: { styleId: string; chart: SizeChartScreen }) {
  const [editing, setEditing] = useState(false);
  const unitWord = chart.unit === "INCH" ? "inches" : "cm";
  return (
    <Panel
      title="Size chart"
      id="size-chart-heading"
      action={
        chart.canEdit && chart.sizes.length > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <RulerIcon aria-hidden />
            Edit size chart
          </Button>
        ) : undefined
      }
    >
      {chart.sizes.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Add the style&apos;s sizes first: the size chart has a column for each.
        </p>
      ) : !chart.saved ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No size chart yet. It tells the shops&apos; customers what each size measures.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            {GARMENT_LABELS[chart.garment]}, in {unitWord}. The shops get it; their own changes stay
            on their sites.
          </p>
          <div className="mt-4 min-w-0 overflow-x-auto rounded-md border">
            <table className="w-full min-w-max text-sm tabular-nums" aria-label="Size chart">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Measurement
                  </th>
                  {chart.sizes.map((s) => (
                    <th key={s.id} scope="col" className="px-3 py-2 text-center font-medium">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.points.map((p) => (
                  <tr key={p.name} className="border-t">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {p.name}
                    </th>
                    {chart.sizes.map((s) => {
                      const v = p.values[s.id];
                      return (
                        <td key={s.id} className="px-3 py-2 text-center">
                          {v === null || v === undefined ? (
                            "-"
                          ) : (
                            <>
                              {v}
                              <span className="block text-xs text-muted-foreground">
                                {other(v, chart.unit)}
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing && (
        <EditSizeChart styleId={styleId} chart={chart} onClose={() => setEditing(false)} />
      )}
    </Panel>
  );
}

function EditSizeChart({
  styleId,
  chart,
  onClose,
}: {
  styleId: string;
  chart: SizeChartScreen;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ChartValue>(() => toEditor(chart));
  const [note, setNote] = useState<string>();
  const [filling, startFill] = useTransition();

  return (
    <FormDialog
      title="Edit size chart"
      description="What each size measures. Type the numbers in the unit you choose; the other unit shows under each."
      submitLabel="Save the size chart"
      pendingLabel="Saving"
      errorTitle="The size chart was not saved"
      className="sm:max-w-3xl"
      onClose={onClose}
      onSubmit={async () => {
        const result = await saveSizeChartAction(styleId, chartInput(value));
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          {chart.hasTechPack && (
            <div className="grid gap-2">
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                disabled={filling}
                onClick={() =>
                  startFill(async () => {
                    const result = await sizeChartFromTechPackAction(styleId);
                    if (!result.ok) {
                      setNote(result.error.message);
                      return;
                    }
                    setValue(() =>
                      toEditor({
                        garment: result.data.garment,
                        unit: result.data.unit,
                        points: result.data.points,
                      }),
                    );
                    setNote(`Filled from ${result.data.techPack}. Check the numbers, then save.`);
                  })
                }
              >
                Fill from the tech pack
              </Button>
              {note && <FormAlert tone="note">{note}</FormAlert>}
            </div>
          )}
          <SizeChartEditor
            idPrefix="style-size-chart"
            sizes={chart.sizes}
            value={value}
            onChange={setValue}
            error={
              fieldError("points") ??
              value.points.map((_, i) => fieldError(`points.${i}.name`)).find(Boolean)
            }
          />
        </>
      )}
    </FormDialog>
  );
}
