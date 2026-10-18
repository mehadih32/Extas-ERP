"use client";

import type { GarmentCategory, MeasurementUnit, RawMaterialKind } from "@prisma/client";
import { CalculatorIcon, LibraryIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import {
  KIND_LABELS,
  KINDS,
  UNIT_LABELS,
  UNIT_NAMES,
  UNIT_ONE,
  UNITS,
} from "@/components/materials/labels";
import { Chosen, MaterialPicker } from "@/components/materials/pickers";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CATEGORY_PRESETS,
  DIA_LABELS,
  DIA_TYPES,
  type LineRole,
  ROLE_LABELS,
  SPEC_FIELD_INFO,
  type SpecField,
  WEIGHT_LABELS,
} from "@/modules/production/booking-presets";
import type { BookingBatchPick } from "@/modules/production/booking.service";

import {
  customLine,
  type DraftCollar,
  type DraftLine,
  fabricLine,
  fieldsOf,
  lineFromPick,
  lineQuantity,
  presetTrimLines,
  quantityLabel,
} from "./booking-draft";
import { Segmented, StepHeading } from "./booking-form-bits";
import { MaterialThumb } from "./material-thumb";

type Problem = (name: string) => string | undefined;

const TRIM_KINDS = KINDS.filter((k) => k !== "FABRIC");

const FABRIC_HELP: Record<GarmentCategory, string> = {
  KNITWEAR:
    "Knitwear fabric is booked by the kilogram with its GSM and DIA (tube or open). Add rib or a contrast fabric as another fabric.",
  WOVEN: "Woven fabric is booked by the yard or metre with its width, construction and weight.",
  OUTERWEAR:
    "The shell fabric by the yard or metre with its width and weight. Lining and padding are on the next step.",
  SWEATER:
    "Sweaters are booked as yarn, by the pound or kilogram, with the count and the gauge (GG).",
  OTHER: "The fabric with whatever describes it. A booking can also carry trims only.",
};

/** "6.5" with up to 3 decimals, for an amount worked out on the screen. */
const amountOf = (quantity: number | null, price: string) => {
  const p = Number(price.replace(/,/g, ""));
  if (!quantity || !price.trim() || !Number.isFinite(p)) return null;
  return (Math.round(quantity * p * 100) / 100).toFixed(2);
};

/** One item on the booking: what it is, its specification, how much and at what price. */
function LineCard({
  line,
  index,
  category,
  collar,
  currency,
  priceNeeded,
  problem,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  index: number;
  category: GarmentCategory;
  collar: DraftCollar;
  currency: string;
  /** Goods going into stock as the booking is saved need their price now. */
  priceNeeded: boolean;
  problem: Problem;
  onChange: (next: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const id = (field: string) => `line-${line.key}-${field}`;
  const err = (field: string) => problem(`lines.${index}.${field}`);
  const preset = CATEGORY_PRESETS[category];
  const fabric = line.role === "FABRIC";
  const units: readonly MeasurementUnit[] = fabric
    ? [...new Set([...preset.fabricUnits, line.unit])]
    : UNITS;
  const worked = lineQuantity(line, collar);
  const fromMatrix = worked.source === "matrix";
  const amount = amountOf(worked.value, line.unitPrice);
  const setSpec = (field: SpecField, value: string) =>
    onChange({ specs: { ...line.specs, [field]: value } });
  const title = line.material
    ? `${line.material.code} · ${line.material.name}`
    : line.name.trim() || (fabric ? "New fabric" : "New item");

  function specField(field: SpecField) {
    const info = SPEC_FIELD_INFO[field];
    const fieldId = id(field);
    const error = err(`specs.${field}`);
    const input = (
      <Input
        id={fieldId}
        value={line.specs[field]}
        onChange={(e) => setSpec(field, e.target.value)}
        inputMode={info.numeric ? "decimal" : undefined}
        placeholder={field === "size" && line.hint ? line.hint : info.placeholder}
        autoComplete="off"
        maxLength={info.numeric ? 12 : 120}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${fieldId}-error` : undefined}
      />
    );
    if (field === "weight") {
      const single = preset.weightUnits.length <= 1;
      return (
        <Field
          key={field}
          id={fieldId}
          label={single ? `Weight (${WEIGHT_LABELS[preset.weightUnits[0] ?? "GSM"]})` : "Weight"}
          error={error}
        >
          <div className="flex gap-2">
            {input}
            {!single && (
              <Segmented
                label="Weight unit"
                size="sm"
                options={preset.weightUnits.map((w) => ({ value: w, label: WEIGHT_LABELS[w] }))}
                value={line.specs.weightUnit}
                onChange={(weightUnit) => onChange({ specs: { ...line.specs, weightUnit } })}
              />
            )}
          </div>
        </Field>
      );
    }
    if (field === "dia") {
      return (
        <Field key={field} id={fieldId} label={info.label} error={error}>
          <div className="flex gap-2">
            {input}
            <Segmented
              label="Tube or open"
              size="sm"
              options={DIA_TYPES.map((d) => ({ value: d, label: DIA_LABELS[d] }))}
              value={line.specs.diaType}
              onChange={(diaType) => onChange({ specs: { ...line.specs, diaType } })}
            />
          </div>
        </Field>
      );
    }
    return (
      <Field
        key={field}
        id={fieldId}
        label={field === "size" && !fabric ? "Size / details" : info.label}
        error={error}
      >
        {input}
      </Field>
    );
  }

  return (
    <li className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {line.imageId && <MaterialThumb imageId={line.imageId} alt={title} />}
          <div className="min-w-0">
            <p className="eyebrow">
              {index + 1}. {ROLE_LABELS[line.role]}
            </p>
            <p className="mt-1 font-serif text-lg leading-snug break-words text-primary">{title}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
        >
          <Trash2Icon aria-hidden />
          Remove
        </Button>
      </div>

      {line.material ? (
        <Chosen
          title={`${line.material.code} · ${line.material.name}`}
          detail={`${KIND_LABELS[line.material.kind]} · ${UNIT_NAMES[line.material.unit]} · from the catalogue`}
          noun="the material"
          onClear={() => onChange({ material: null })}
        />
      ) : picking ? (
        <div className="grid gap-2">
          <MaterialPicker
            id={id("pick")}
            label="Find it in the catalogue"
            currency={currency}
            autoFocus
            onPick={(m) => {
              onChange({
                material: { id: m.id, code: m.code, name: m.name, kind: m.kind, unit: m.unit },
                name: m.name,
                kind: m.kind,
                unit: m.unit,
                role: m.kind === "FABRIC" ? "FABRIC" : line.role === "FABRIC" ? "TRIM" : line.role,
              });
              setPicking(false);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setPicking(false)}
          >
            Type a new item instead
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field
              id={id("name")}
              label={fabric ? "Fabric name" : "Item name"}
              error={err("name") ?? err("materialId")}
              hint="A new item is added to the materials catalogue when the booking is saved."
            >
              <Input
                id={id("name")}
                value={line.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder={fabric ? preset.fabricName : "Main label"}
                autoComplete="off"
                maxLength={160}
                aria-invalid={Boolean(err("name"))}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:mt-[1.625rem] sm:w-auto"
              onClick={() => setPicking(true)}
            >
              <LibraryIcon aria-hidden />
              Pick from the catalogue
            </Button>
          </div>
          <div className="grid items-start gap-4 sm:grid-cols-3">
            {!fabric && (
              <Field id={id("kind")} label="Kind">
                <NativeSelect
                  id={id("kind")}
                  containerClassName="sm:w-full"
                  value={line.kind}
                  onChange={(e) => onChange({ kind: e.target.value as RawMaterialKind })}
                >
                  {TRIM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field id={id("unit")} label="Unit" error={err("unit")}>
              <NativeSelect
                id={id("unit")}
                containerClassName="sm:w-full"
                value={line.unit}
                onChange={(e) => onChange({ unit: e.target.value as MeasurementUnit })}
                aria-invalid={Boolean(err("unit"))}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_NAMES[u]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!fabric && preset.collarMatrix && (
              <Field id={id("role")} label="Counts as">
                <NativeSelect
                  id={id("role")}
                  containerClassName="sm:w-full"
                  value={line.role}
                  onChange={(e) => onChange({ role: e.target.value as LineRole })}
                >
                  {(["TRIM", "COLLAR", "CUFF"] as const).map((r) => (
                    <option key={r} value={r}>
                      {r === "TRIM" ? "A trim" : `The ${ROLE_LABELS[r].toLowerCase()}`}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fieldsOf(line, category).map(specField)}
      </div>

      <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:p-4">
        {fromMatrix ? (
          <div className="grid gap-1">
            <p className="text-sm font-medium">
              Quantity from the collar &amp; cuff matrix:{" "}
              <span className="tabular-nums">
                {worked.value
                  ? quantityLabel(worked.value, line.unit, currency)
                  : "enter the pieces"}
              </span>
            </p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {line.role === "CUFF" && line.unit === "PCS" ? "Two cuffs a set. " : ""}
              Change the pieces on the Collar &amp; cuff step.
            </p>
            {err("quantity") && (
              <p className="text-[0.8125rem] text-destructive">{err("quantity")}</p>
            )}
          </div>
        ) : (
          <>
            {fabric && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">How much to book</span>
                <Segmented
                  label="How much to book"
                  size="sm"
                  options={[
                    { value: "typed", label: "Type it" },
                    { value: "calc", label: "Work it out" },
                  ]}
                  value={line.calc.on ? "calc" : "typed"}
                  onChange={(v) => onChange({ calc: { ...line.calc, on: v === "calc" } })}
                />
              </div>
            )}
            {line.calc.on && fabric ? (
              <div className="grid gap-3">
                <div className="grid items-start gap-3 sm:grid-cols-3">
                  <Field id={id("pieces")} label="Garment pieces" error={err("specs.pieces")}>
                    <Input
                      id={id("pieces")}
                      inputMode="numeric"
                      value={line.calc.pieces}
                      onChange={(e) => onChange({ calc: { ...line.calc, pieces: e.target.value } })}
                      autoComplete="off"
                      aria-invalid={Boolean(err("specs.pieces"))}
                    />
                  </Field>
                  <Field
                    id={id("per-dozen")}
                    label={`Consumption per dozen (${UNIT_LABELS[line.unit]})`}
                    error={err("specs.perDozen")}
                  >
                    <Input
                      id={id("per-dozen")}
                      inputMode="decimal"
                      value={line.calc.perDozen}
                      onChange={(e) =>
                        onChange({ calc: { ...line.calc, perDozen: e.target.value } })
                      }
                      placeholder={line.unit === "KG" ? "2.75" : "16"}
                      autoComplete="off"
                      aria-invalid={Boolean(err("specs.perDozen"))}
                    />
                  </Field>
                  <Field
                    id={id("loss")}
                    label="Process loss (%)"
                    error={err("specs.lossPercent")}
                    hint="Dyeing, finishing and cutting"
                  >
                    <Input
                      id={id("loss")}
                      inputMode="decimal"
                      value={line.calc.loss}
                      onChange={(e) => onChange({ calc: { ...line.calc, loss: e.target.value } })}
                      autoComplete="off"
                      aria-invalid={Boolean(err("specs.lossPercent"))}
                    />
                  </Field>
                </div>
                <p className="flex items-center gap-2 text-sm" aria-live="polite">
                  <CalculatorIcon className="size-4 text-primary" aria-hidden />
                  {worked.value ? (
                    <span>
                      Book{" "}
                      <strong className="tabular-nums">
                        {quantityLabel(worked.value, line.unit, currency)}
                      </strong>{" "}
                      (pieces ÷ 12 × consumption + loss, rounded up)
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      Enter the pieces and the consumption per dozen.
                    </span>
                  )}
                </p>
              </div>
            ) : (
              <Field
                id={id("quantity")}
                label={`Quantity (${UNIT_LABELS[line.unit]})`}
                error={err("quantity")}
              >
                <Input
                  id={id("quantity")}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => onChange({ quantity: e.target.value })}
                  autoComplete="off"
                  aria-invalid={Boolean(err("quantity"))}
                  className="sm:max-w-56"
                />
              </Field>
            )}
          </>
        )}
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field
            id={id("price")}
            label={`Price per ${UNIT_ONE[line.unit]} (${currency}${priceNeeded ? "" : ", optional"})`}
            error={err("unitPrice")}
            hint={
              amount
                ? `${money(amount, currency)} for this item`
                : priceNeeded
                  ? "The price paid: the goods go into stock as the booking is saved."
                  : "Leave it empty to agree the price when the goods arrive."
            }
          >
            <Input
              id={id("price")}
              inputMode="decimal"
              value={line.unitPrice}
              onChange={(e) => onChange({ unitPrice: e.target.value })}
              placeholder={priceNeeded ? "Price paid" : "At receive"}
              autoComplete="off"
              aria-invalid={Boolean(err("unitPrice"))}
            />
          </Field>
          <Field id={id("notes")} label="Note for the supplier (optional)">
            <Input
              id={id("notes")}
              value={line.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder={fabric ? "Main body, soft hand feel" : "Neck tape, inside"}
              autoComplete="off"
              maxLength={500}
            />
          </Field>
        </div>
      </div>
    </li>
  );
}

/** Buttons that add a preset or batch item with a tap. */
function QuickAdd({
  label,
  items,
}: {
  label: string;
  items: ReadonlyArray<{ key: string; text: string; onAdd: () => void }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="text-[0.8125rem] font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Button
            key={item.key}
            type="button"
            size="sm"
            variant="outline"
            className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal"
            onClick={item.onAdd}
          >
            <PlusIcon aria-hidden />
            <span className="min-w-0 break-words">{item.text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * The fabric step (the main fabric or yarn and any other fabric) or the trims
 * step (the family's trims, loaded already, and anything added with "Add custom
 * item"). Lines keep their place in the booking; each step shows its own.
 */
export function ItemsStep({
  step,
  category,
  lines,
  collar,
  garmentPieces,
  batchPicks,
  currency,
  priceNeeded = false,
  problem,
  onLines,
}: {
  step: "fabric" | "trims";
  category: GarmentCategory;
  lines: DraftLine[];
  collar: DraftCollar;
  garmentPieces: string;
  batchPicks: BookingBatchPick[];
  currency: string;
  priceNeeded?: boolean;
  problem: Problem;
  onLines: (lines: DraftLine[]) => void;
}) {
  const fabric = step === "fabric";
  const mine = (l: DraftLine) => (fabric ? l.role === "FABRIC" : l.role !== "FABRIC");
  const shown = lines.map((line, index) => ({ line, index })).filter(({ line }) => mine(line));
  const names = new Set(lines.map((l) => (l.material?.name ?? l.name).trim().toLowerCase()));
  const onBooking = new Set(lines.flatMap((l) => (l.material ? [l.material.id] : [])));
  const picks = batchPicks.filter(
    (p) => (p.material.kind === "FABRIC") === fabric && !onBooking.has(p.material.id),
  );
  const presets = fabric
    ? []
    : presetTrimLines(category).filter((t) => !names.has(t.name.toLowerCase()));
  const headingId = `step-${step}-heading`;
  const add = (line: DraftLine) => onLines([...lines, line]);

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-5">
      <StepHeading id={headingId} title={fabric ? "Fabric" : "Trims & accessories"}>
        {fabric
          ? FABRIC_HELP[category]
          : collar.on
            ? "The garment family's trims are loaded. Collars and cuffs take their quantity from the matrix; type the rest, remove what is not needed, or add your own."
            : "The garment family's trims are loaded. Type each quantity, remove what is not needed, or add your own."}
      </StepHeading>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {fabric
            ? "No fabric on this booking. Add one, or go on to book trims only."
            : "No trims on this booking. Add one, or go on."}
        </p>
      ) : (
        <ol className="grid gap-4" aria-label={fabric ? "Fabric" : "Trims and accessories"}>
          {shown.map(({ line, index }) => (
            <LineCard
              key={line.key}
              line={line}
              index={index}
              category={category}
              collar={collar}
              currency={currency}
              priceNeeded={priceNeeded}
              problem={problem}
              onChange={(next) =>
                onLines(lines.map((l) => (l.key === line.key ? { ...l, ...next } : l)))
              }
              onRemove={() => onLines(lines.filter((l) => l.key !== line.key))}
            />
          ))}
        </ol>
      )}

      <div className="grid gap-4 rounded-lg border border-dashed p-4">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto sm:justify-self-start"
          onClick={() => add(fabric ? fabricLine(category, garmentPieces) : customLine("TRIM"))}
        >
          <PlusIcon aria-hidden />
          {fabric ? "Add another fabric" : "Add custom item"}
        </Button>
        <QuickAdd
          label="Add back a standard trim"
          items={presets.map((t) => ({
            key: t.name,
            text: t.name,
            onAdd: () => add(t),
          }))}
        />
        <QuickAdd
          label="From the batch's materials"
          items={picks.map((p) => ({
            key: p.material.id,
            text: `${p.material.code} · ${p.material.name}${
              /[1-9]/.test(p.toOrder)
                ? ` (${p.toOrder} ${UNIT_LABELS[p.material.unit]} to order)`
                : ""
            }`,
            onAdd: () => add(lineFromPick(p, garmentPieces)),
          }))}
        />
      </div>
    </section>
  );
}
