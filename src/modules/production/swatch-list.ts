import type { MeasurementUnit } from "@prisma/client";

import { quantity as materialQuantity } from "@/components/materials/labels";
import type { Block } from "@/modules/documents/model";

/*
 * The fabric swatch list: the owner's production-control page at the end of a
 * booking book or a fabric booking. One row per style and colour, with a blank
 * box about 15 mm tall to paste the fabric swatch in, and blank columns for the
 * rolls received and the cutting report, filled in by hand.
 */

/** A swatch row's height: about 15 mm, room to paste a swatch. */
export const SWATCH_ROW_HEIGHT = (15 * 72) / 25.4;

export type SwatchRow = {
  /** "A-01 · Navy" or "PL-01 Polo · Navy" */
  label: string;
  quantity: number;
  unit: MeasurementUnit;
};

const num = (n: number) => String(Number(n.toFixed(3)));

/** Quantities by unit: "936 kg" or "500 kg + 120 yd". */
function totalText(rows: SwatchRow[], currency: string): string {
  const byUnit = new Map<MeasurementUnit, number>();
  for (const r of rows) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.quantity);
  return [...byUnit]
    .map(([unit, total]) => materialQuantity(num(total), unit, currency))
    .join(" + ");
}

/** The swatch list of one supplier's fabric, on a page of its own. */
export function swatchListBlocks(
  supplierName: string,
  rows: SwatchRow[],
  currency: string,
): Block[] {
  if (rows.length === 0) return [];
  return [
    {
      kind: "section",
      title: `Fabric swatch list · ${supplierName}`,
      label: "Swatch list",
      subtitle:
        "Paste a swatch of each fabric as it arrives; write the rolls received and the cutting report.",
    },
    {
      kind: "table",
      columns: [
        { label: "SL No.", align: "right", weight: 0.6 },
        { label: "Swatch paste area", weight: 2.3 },
        { label: "Style · colour", weight: 2.2 },
        { label: "Quantity", align: "right", weight: 1.3 },
        { label: "No. of rolls", weight: 1.4 },
        { label: "Cutting report", weight: 1.8 },
      ],
      rows: [
        ...rows.map((r, i) => ({
          cells: [
            String(i + 1),
            "",
            r.label,
            materialQuantity(num(r.quantity), r.unit, currency),
            "",
            "",
          ],
          height: SWATCH_ROW_HEIGHT,
        })),
        {
          cells: [
            "",
            `TOTAL ${supplierName.toUpperCase()} FABRIC`,
            "",
            totalText(rows, currency),
            "____ - Roll",
            "",
          ],
          style: "total" as const,
        },
      ],
    },
  ];
}
