"use client";

import type { StockGrade } from "@prisma/client";

import { NativeSelect } from "@/components/ui/native-select";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";

import { GRADE_LABELS } from "./labels";

/** A SKU's stock in one warehouse, as the SKU details give it. */
export type Shelf = {
  /** null: the default warehouse, set up by the first stock change. */
  id: string | null;
  name: string;
  aGrade: number;
  bGrade: number;
  /** A-grade pieces set aside for orders. */
  reserved: number;
  /** B-grade pieces set aside for a retail store's B-grade lines. */
  bReserved: number;
};

export const shelfKey = (shelf: Pick<Shelf, "id">) => shelf.id ?? "default";

/** Pieces of a grade on a shelf (including those set aside for orders). */
export const onShelf = (shelf: Shelf, grade: StockGrade) =>
  grade === "A_GRADE" ? shelf.aGrade : shelf.bGrade;

/** Pieces of a grade set aside for orders on a shelf. */
export const setAside = (shelf: Shelf, grade: StockGrade) =>
  grade === "A_GRADE" ? shelf.reserved : shelf.bReserved;

/** Which warehouse: a picker when there are several, otherwise just its name. */
export function WarehousePicker({
  id,
  shelves,
  value,
  onChange,
}: {
  id: string;
  shelves: Shelf[];
  value: string;
  onChange: (key: string) => void;
}) {
  if (shelves.length === 1) {
    return <p className="text-sm">{shelves[0]!.name}</p>;
  }
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      containerClassName="sm:w-full"
      className="md:h-10"
    >
      {shelves.map((shelf) => (
        <option key={shelfKey(shelf)} value={shelfKey(shelf)}>
          {shelf.name}
        </option>
      ))}
    </NativeSelect>
  );
}

/** A-grade or B-grade, with the pieces of each on the shelf. */
export function GradeToggle({
  shelf,
  value,
  onChange,
  currency,
  labelledBy,
}: {
  shelf: Shelf;
  value: StockGrade;
  onChange: (grade: StockGrade) => void;
  currency: string;
  labelledBy: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid grid-cols-2 rounded-md border bg-card p-1 text-sm"
    >
      {(["A_GRADE", "B_GRADE"] as const).map((grade) => (
        <button
          key={grade}
          type="button"
          role="radio"
          aria-checked={value === grade}
          onClick={() => onChange(grade)}
          className={cn(
            "h-10 cursor-pointer rounded-sm px-3 whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 md:h-8",
            value === grade
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {GRADE_LABELS[grade]} ({formatCount(onShelf(shelf, grade), currency)})
        </button>
      ))}
    </div>
  );
}
