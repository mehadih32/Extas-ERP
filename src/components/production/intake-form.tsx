"use client";

import type { CostAllocationMethod } from "@prisma/client";
import { LoaderCircleIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount } from "@/components/products/form-values";
import { ColorName } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type {
  IntakeForm as IntakeFormData,
  IntakeMatrix,
} from "@/modules/production/screens.service";
import {
  createIntakeAction,
  getIntakeMatrixAction,
  updateIntakeAction,
  uploadProductionFileAction,
} from "@/server/actions/production.actions";

import { COSTING_HINTS, COSTING_LABELS, productionHref } from "./labels";
import { ProductionStylePicker } from "./pickers";

type Grade = "A" | "B";

/** One style received: its colours by sizes, and pieces per SKU for each grade. */
type Block = {
  key: string;
  styleId: string;
  matrix: IntakeMatrix | null;
  loadError?: string;
  a: Record<string, string>;
  b: Record<string, string>;
  /** Which grade's boxes show. */
  showing: Grade;
};

// Styles added in the browser get keys from this counter; the ones the page
// starts with are keyed by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `style-${++nextKey}`;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const COSTINGS: readonly CostAllocationMethod[] = ["EQUAL_PER_PIECE", "B_GRADE_RATIO", "MANUAL"];

const asText = (quantities: Record<string, number>) =>
  Object.fromEntries(Object.entries(quantities).map(([id, q]) => [id, String(q)]));

/** A whole number of pieces, 0 for an empty box, or NaN for anything else. */
const piecesIn = (text: string | undefined) => {
  const value = (text ?? "").trim();
  if (value === "") return 0;
  return /^\d{1,7}$/.test(value) ? Number(value) : NaN;
};

const sumOf = (quantities: Record<string, string>) =>
  Object.values(quantities).reduce((s, q) => s + (piecesIn(q) || 0), 0);

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-5 border-t pt-6 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 font-serif text-lg text-primary">{title}</legend>
      <div className="clear-left grid min-w-0 gap-5">
        {hint && <p className="-mt-3 text-sm text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </fieldset>
  );
}

/**
 * A factory delivery (Move to Stock), new or a draft being corrected: the
 * pieces received per colour and size, A-grade and B-grade apart, the warehouse
 * they go into, the factory's packing list and, for people who see costs, how
 * the project's cost is split over the pieces. The packing list is kept as a
 * photo or PDF; reading it automatically comes later with the AI integrations.
 */
export function IntakeForm({ form: data, currency }: { form: IntakeFormData; currency: string }) {
  const router = useRouter();
  const intake = data.intake;
  const project = data.project!;
  const [blocks, setBlocks] = useState<Block[]>(() =>
    data.blocks.map((b, i) => ({
      key: `start-${i}`,
      styleId: b.matrix.style.id,
      matrix: b.matrix,
      a: asText(b.a),
      b: asText(b.b),
      showing: "A" as Grade,
    })),
  );
  const [costing, setCosting] = useState<CostAllocationMethod>(
    intake?.costAllocation ?? "EQUAL_PER_PIECE",
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const general = error && error.code !== "INTERNAL" ? error.message : undefined;

  const aPieces = blocks.reduce((s, b) => s + sumOf(b.a), 0);
  const bPieces = blocks.reduce((s, b) => s + sumOf(b.b), 0);

  function change(key: string, next: Partial<Block>) {
    setBlocks((all) => all.map((b) => (b.key === key ? { ...b, ...next } : b)));
  }

  async function loadBlock(key: string, styleId: string) {
    const result = await getIntakeMatrixAction(styleId);
    change(key, result.ok ? { matrix: result.data } : { loadError: result.error.message });
  }

  function addStyle(styleId: string) {
    const key = newKey();
    setBlocks((all) => [...all, { key, styleId, matrix: null, a: {}, b: {}, showing: "A" }]);
    void loadBlock(key, styleId);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const lines: Array<{
      variantId: string;
      grade: "A_GRADE" | "B_GRADE";
      quantity: number;
      unitCost?: number;
    }> = [];

    let unitCostA: number | undefined;
    let unitCostB: number | undefined;
    if (data.seeCosts && costing === "MANUAL") {
      for (const [grade, pieces] of [
        ["A", aPieces],
        ["B", bPieces],
      ] as const) {
        if (pieces === 0) continue;
        const amount = readAmount(String(form.get(`unitCost${grade}`) ?? ""));
        if (amount === "invalid") found[`unitCost${grade}`] = AMOUNT_HINT;
        else if (amount === null)
          found[`unitCost${grade}`] = `Enter what a ${grade}-grade piece cost.`;
        else if (grade === "A") unitCostA = amount;
        else unitCostB = amount;
      }
    }
    let bGradeCostRatio: number | undefined;
    if (data.seeCosts && costing === "B_GRADE_RATIO") {
      const percent = Number(String(form.get("bGradePercent") ?? "").trim());
      if (!(percent >= 0 && percent <= 100)) found.bGradePercent = "Enter a share from 0 to 100.";
      else bGradeCostRatio = Math.round(percent * 10) / 1000;
    }

    for (const block of blocks) {
      if (!block.matrix) continue;
      for (const row of block.matrix.rows) {
        for (const cell of row.cells) {
          if (!cell) continue;
          for (const grade of ["A", "B"] as const) {
            const quantity = piecesIn((grade === "A" ? block.a : block.b)[cell.variantId]);
            if (Number.isNaN(quantity)) {
              found[`block.${block.key}`] = "Pieces are whole numbers, like 24.";
              continue;
            }
            if (quantity === 0) continue;
            lines.push({
              variantId: cell.variantId,
              grade: grade === "A" ? "A_GRADE" : "B_GRADE",
              quantity,
              ...(costing === "MANUAL" && data.seeCosts
                ? { unitCost: (grade === "A" ? unitCostA : unitCostB) ?? 0 }
                : {}),
            });
          }
        }
      }
    }
    if (lines.length === 0 && Object.keys(found).length === 0) {
      found.lines = "Enter the pieces received in at least one size.";
    }
    if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
    setProblems(found);
    setError(undefined);
    if (Object.keys(found).length > 0) return;

    const shared = {
      warehouseId: String(form.get("warehouseId") ?? "") || undefined,
      lines,
      ...(data.seeCosts ? { costAllocation: costing, bGradeCostRatio } : {}),
      notes: String(form.get("notes") ?? "").trim() || null,
    };

    startTransition(async () => {
      let sourceFileId: string | undefined;
      if (file && !intake) {
        const upload = new FormData();
        upload.set("file", file);
        const stored = await uploadProductionFileAction(upload);
        if (!stored.ok) {
          setProblems({ file: stored.error.message });
          return;
        }
        sourceFileId = stored.data.id;
      }
      const result = intake
        ? await updateIntakeAction(intake.id, shared)
        : await createIntakeAction({
            projectId: project.id,
            sourceFileId,
            parse: false,
            ...shared,
          });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${productionHref.delivery(result.data.id)}?${intake ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-4xl gap-8" noValidate>
      <Section
        title="Pieces received"
        hint="Count each colour and size off the factory's packing list. B-grade pieces (small faults) go in apart, on the B-grade tab."
      >
        {blocks.length === 0 && (
          <FormAlert tone="note">Choose the style the factory delivered.</FormAlert>
        )}
        <ul className="grid grid-cols-1 gap-4">
          {blocks.map((block) => (
            <StyleBlock
              key={block.key}
              block={block}
              error={fieldError(`block.${block.key}`)}
              onChange={(next) => change(block.key, next)}
              onRemove={() => setBlocks((all) => all.filter((b) => b.key !== block.key))}
            />
          ))}
        </ul>
        <Field
          id="add-style"
          label={blocks.length === 0 ? "Style" : "Another style in this delivery (optional)"}
        >
          <ProductionStylePicker
            id="add-style"
            label="Add a style"
            exclude={blocks.map((b) => b.styleId)}
            onChange={(style) => style && addStyle(style.id)}
          />
        </Field>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md bg-muted/50 px-4 py-3 text-sm tabular-nums">
          <span>
            <span className="text-muted-foreground">A-grade </span>
            <span className="font-medium">{formatCount(aPieces, currency)} pcs</span>
          </span>
          <span>
            <span className="text-muted-foreground">B-grade </span>
            <span className="font-medium">{formatCount(bPieces, currency)} pcs</span>
          </span>
          <span>
            <span className="text-muted-foreground">In all </span>
            <span className="font-medium">{formatCount(aPieces + bPieces, currency)} pcs</span>
          </span>
        </div>
        {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
      </Section>

      <Section title="Into the store">
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field id="warehouseId" label="Warehouse" error={fieldError("warehouseId")}>
            <NativeSelect
              id="warehouseId"
              name="warehouseId"
              defaultValue={intake?.warehouseId ?? data.defaultWarehouseId}
              containerClassName="sm:w-full"
              className="md:h-10"
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {intake ? (
            <Field id="packing-list" label="Packing list">
              {intake.sourceFile ? (
                <a
                  id="packing-list"
                  href={productionHref.file(intake.sourceFile.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                >
                  <PaperclipIcon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{intake.sourceFile.fileName}</span>
                </a>
              ) : (
                <p id="packing-list" className="text-sm text-muted-foreground">
                  None attached
                </p>
              )}
            </Field>
          ) : (
            <Field
              id="file"
              label="Packing list photo or PDF (optional)"
              hint="Kept with the delivery. Up to 10 MB."
              error={fieldError("file")}
            >
              <Input
                id="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="h-auto py-1.5 file:mr-3"
                aria-invalid={Boolean(fieldError("file"))}
                aria-describedby={fieldError("file") ? "file-error" : "file-hint"}
              />
            </Field>
          )}
        </div>
      </Section>

      {data.seeCosts && (
        <Section
          title="Cost of the pieces"
          hint="When it is confirmed, the delivery takes its share of the project's cost into stock. Choose how that is split over its pieces."
        >
          <ChoiceList<CostAllocationMethod>
            name="costAllocation"
            legend="Split the cost"
            defaultValue={costing}
            onChange={setCosting}
            options={COSTINGS.map((c) => ({
              value: c,
              label: COSTING_LABELS[c],
              hint: COSTING_HINTS[c],
            }))}
          />
          {costing === "B_GRADE_RATIO" && (
            <Field
              id="bGradePercent"
              label="A B-grade piece carries (% of an A-grade piece's cost)"
              error={fieldError("bGradePercent") ?? fieldError("bGradeCostRatio")}
            >
              <Input
                id="bGradePercent"
                name="bGradePercent"
                inputMode="decimal"
                defaultValue={intake?.bGradePercent ?? data.defaultBGradePercent}
                className="sm:w-32"
                autoComplete="off"
                aria-invalid={Boolean(fieldError("bGradePercent"))}
                aria-describedby={fieldError("bGradePercent") ? "bGradePercent-error" : undefined}
              />
            </Field>
          )}
          {costing === "MANUAL" && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="unitCostA" label="An A-grade piece cost" error={fieldError("unitCostA")}>
                <Input
                  id="unitCostA"
                  name="unitCostA"
                  inputMode="decimal"
                  defaultValue={intake?.unitCostA ?? ""}
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("unitCostA"))}
                  aria-describedby={fieldError("unitCostA") ? "unitCostA-error" : undefined}
                />
              </Field>
              <Field id="unitCostB" label="A B-grade piece cost" error={fieldError("unitCostB")}>
                <Input
                  id="unitCostB"
                  name="unitCostB"
                  inputMode="decimal"
                  defaultValue={intake?.unitCostB ?? ""}
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("unitCostB"))}
                  aria-describedby={fieldError("unitCostB") ? "unitCostB-error" : undefined}
                />
              </Field>
            </div>
          )}
        </Section>
      )}

      <Section title="Notes">
        <Field id="notes" label="Notes (optional)" error={fieldError("notes")}>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={intake?.notes ?? ""}
            rows={3}
            maxLength={2000}
            placeholder="Like: 2 cartons, 12 pieces with stains set aside."
          />
        </Field>
      </Section>

      {general && <FormAlert>{general}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link
            href={intake ? productionHref.delivery(intake.id) : productionHref.project(project.id)}
          >
            Cancel
          </Link>
        </Button>
        <Button
          type="submit"
          className="w-full sm:w-auto"
          disabled={pending || blocks.some((b) => !b.matrix && !b.loadError)}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {intake
            ? pending
              ? "Saving"
              : "Save the delivery"
            : pending
              ? "Saving"
              : "Save as a draft"}
        </Button>
      </div>
      <p className="-mt-4 text-[0.8125rem] text-muted-foreground">
        Nothing goes into stock until the delivery is confirmed on the next page.
      </p>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the delivery"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}

function StyleBlock({
  block,
  error,
  onChange,
  onRemove,
}: {
  block: Block;
  error?: string;
  onChange: (change: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const m = block.matrix;
  const title = m ? `${m.style.code} · ${m.style.name}` : "Loading the style";
  const quantities = block.showing === "A" ? block.a : block.b;
  const counts = { A: sumOf(block.a), B: sumOf(block.b) };

  return (
    <li className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">{title}</p>
          {m && (
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {counts.A} A-grade · {counts.B} B-grade
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${m ? m.style.code : "this style"}`}
        >
          <Trash2Icon aria-hidden />
          Remove
        </Button>
      </div>

      {block.loadError ? (
        <FormAlert>{block.loadError}</FormAlert>
      ) : !m ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          Loading colours and sizes
        </p>
      ) : m.rows.length === 0 ? (
        <FormAlert tone="note">
          This style has no SKUs yet. Add its colours and sizes in Products first.
        </FormAlert>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={`Grade for ${m.style.code}`}
            className="inline-grid w-full grid-cols-2 rounded-md border bg-muted/40 p-1 sm:w-80"
          >
            {(["A", "B"] as const).map((grade) => (
              <button
                key={grade}
                type="button"
                role="tab"
                aria-selected={block.showing === grade}
                onClick={() => onChange({ showing: grade })}
                className={cn(
                  "h-9 cursor-pointer rounded-sm px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  block.showing === grade
                    ? "bg-card font-medium text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {grade}-grade
                <span className="ml-1.5 text-[0.8125rem] text-muted-foreground tabular-nums">
                  {counts[grade]}
                </span>
              </button>
            ))}
          </div>
          {!m.style.isActive && (
            <FormAlert tone="note">
              This style is archived; restore it in Products before the delivery is confirmed.
            </FormAlert>
          )}
          <div role="tabpanel" className="grid grid-cols-1 gap-4">
            {m.rows.map((row) => (
              <fieldset key={row.color.id} className="grid min-w-0 gap-2">
                <legend className="mb-1 text-sm font-medium">
                  <ColorName name={row.color.name} hexCode={row.color.hexCode} />
                </legend>
                <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 sm:grid-cols-6">
                  {row.cells.map((cell, index) => {
                    const size = m.sizes[index]!;
                    if (!cell) return null;
                    const inputId = `${block.key}-${block.showing}-${cell.variantId}`;
                    const value = quantities[cell.variantId] ?? "";
                    return (
                      <div key={cell.variantId} className="grid min-w-0 gap-1">
                        <label htmlFor={inputId} className="text-[0.8125rem] font-medium">
                          {size.name}
                        </label>
                        <Input
                          id={inputId}
                          inputMode="numeric"
                          value={value}
                          onChange={(e) =>
                            onChange(
                              block.showing === "A"
                                ? { a: { ...block.a, [cell.variantId]: e.target.value } }
                                : { b: { ...block.b, [cell.variantId]: e.target.value } },
                            )
                          }
                          disabled={!cell.isActive && !value}
                          placeholder="0"
                          aria-label={`${row.color.name} ${size.name}, ${block.showing}-grade pieces`}
                          aria-invalid={Number.isNaN(piecesIn(value))}
                          className="text-right tabular-nums"
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          {error && <FormAlert>{error}</FormAlert>}
        </>
      )}
    </li>
  );
}
