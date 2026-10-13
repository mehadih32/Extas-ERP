"use client";

import {
  ClipboardCheckIcon,
  PackageCheckIcon,
  PaperclipIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ActionError } from "@/lib/result";
import type { FinishingScreen } from "@/modules/production/finishing.service";
import {
  backFromMendingAction,
  deleteFinishingReportAction,
  receivePackingListAction,
  uploadProductionFileAction,
} from "@/server/actions/production.actions";

import { PieceBoxes, readPieces } from "./cutting";
import { cellName } from "./cutting-summary";
import { pieces, productionHref } from "./labels";

/*
 * What Production and the store do on a style's finishing page: start a
 * finishing count, bring C pieces back from mending, receive the full packing
 * list (A and B pieces to stock, missing ones to the factory's fault log), and
 * delete a count entered by mistake.
 */

type Cell = FinishingScreen["cells"][number];
type Report = FinishingScreen["reports"][number];
type Dialog = "mending" | "packing" | null;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const linkClass = "text-primary underline-offset-4 hover:underline";

export const REPORT_KIND_LABELS = {
  COUNT: "Finishing count",
  MENDING: "Back from mending",
  PACKING_LIST: "Packing list",
} as const;

/** One whole-pieces box per grade of a cell, named `${box}.${cell}.${grade}`. */
export function GradeRow({
  box,
  index,
  cell,
  grades,
  fieldError,
  hint,
}: {
  box: string;
  index: number;
  cell: Pick<Cell, "colorName" | "sizeName">;
  grades: ReadonlyArray<{ key: string; label: string }>;
  fieldError: (name: string) => string | undefined;
  hint?: string;
}) {
  const error = fieldError(`${box}.${index}`);
  return (
    <div className="grid gap-1.5">
      <div
        className="grid items-end gap-2"
        style={{
          gridTemplateColumns: `minmax(3.5rem,1fr) repeat(${grades.length},minmax(0,1.2fr))`,
        }}
      >
        <p className="pb-2 text-sm font-medium">{cellName(cell)}</p>
        {grades.map((g) => (
          <Input
            key={g.key}
            id={`${box}-${index}-${g.key}`}
            name={`${box}.${index}.${g.key}`}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${cellName(cell)} ${g.label}`}
            aria-invalid={Boolean(error)}
            className="h-9"
          />
        ))}
      </div>
      {(error || hint) && (
        <p className={cn("text-[0.75rem]", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** The grade names over a block of GradeRows. */
export function GradeHead({ grades }: { grades: ReadonlyArray<{ key: string; label: string }> }) {
  return (
    <div
      aria-hidden
      className="grid gap-2 text-[0.75rem] font-medium tracking-wide text-muted-foreground"
      style={{ gridTemplateColumns: `minmax(3.5rem,1fr) repeat(${grades.length},minmax(0,1.2fr))` }}
    >
      <span />
      {grades.map((g) => (
        <span key={g.key}>{g.label}</span>
      ))}
    </div>
  );
}

const MENDING_GRADES = [
  { key: "a", label: "A-grade" },
  { key: "b", label: "B-grade" },
  { key: "reject", label: "Reject" },
] as const;

/** The buttons above the finishing page, and their windows. */
export function FinishingActions({
  screen,
  currency,
}: {
  screen: FinishingScreen;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Dialog>(null);
  const { project: p, can, packed, totals } = screen;
  const here = productionHref.finishing(p.id);
  if (!can.count && !can.mend && !can.receive) return null;
  const mending = screen.cells.filter((c) => c.c > 0);
  return (
    <div className="flex flex-wrap gap-2">
      {can.count && (
        <Button asChild size="sm">
          <Link href={productionHref.newFinishing(p.id)}>
            <ClipboardCheckIcon aria-hidden />
            New finishing count
          </Link>
        </Button>
      )}
      {can.receive && (
        <Button
          type="button"
          size="sm"
          variant={can.count ? "outline" : "default"}
          onClick={() => setOpen("packing")}
        >
          <PackageCheckIcon aria-hidden />
          {packed ? "Move mended pieces to stock" : "Receive Full Packing List"}
        </Button>
      )}
      {can.mend && (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen("mending")}>
          <WrenchIcon aria-hidden />
          Back from mending
        </Button>
      )}

      {open === "mending" && (
        <FormDialog
          title="Back from mending"
          description="C-grade pieces back from mending, as A-grade, B-grade or reject (could not be fixed)."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the mended pieces"
          onClose={() => setOpen(null)}
          onSubmit={async (form) => {
            const read = readGrades(form, "mend", mending, MENDING_GRADES, (i) => mending[i]!.c);
            if (read.error) return read.error;
            const result = await backFromMendingAction(p.id, {
              countedOn: String(form.get("countedOn") ?? "") || undefined,
              lines: read.lines,
            });
            if (!result.ok) return remapGradeLines(result.error, read.sent, "mend");
            setOpen(null);
            const r = result.data;
            router.push(
              `${here}?mended=${encodeURIComponent(r.number)}&a=${r.a}&b=${r.b}&reject=${r.reject}`,
            );
          }}
        >
          {(fieldError) => (
            <>
              <Field id="mend-day" label="Back on" error={fieldError("countedOn")}>
                <Input
                  id="mend-day"
                  name="countedOn"
                  type="date"
                  max={screen.today}
                  defaultValue={screen.today}
                />
              </Field>
              <fieldset className="grid gap-3">
                <legend className="mb-2 text-sm font-medium">Pieces back</legend>
                <GradeHead grades={MENDING_GRADES} />
                {mending.map((c, i) => (
                  <GradeRow
                    key={cellName(c)}
                    box="mend"
                    index={i}
                    cell={c}
                    grades={MENDING_GRADES}
                    fieldError={fieldError}
                    hint={`${formatCount(c.c, currency)} at mending`}
                  />
                ))}
                {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
              </fieldset>
            </>
          )}
        </FormDialog>
      )}

      {open === "packing" && (
        <PackingListDialog
          screen={screen}
          currency={currency}
          onClose={() => setOpen(null)}
          onDone={(query) => {
            setOpen(null);
            router.push(`${here}?${query}`);
          }}
        />
      )}
      {/* What waits for the packing list, said once beside the buttons. */}
      {can.receive && !packed && totals.toStock.a + totals.toStock.b > 0 && (
        <p className="basis-full text-[0.8125rem] text-muted-foreground">
          {pieces(totals.toStock.a + totals.toStock.b, currency)} graded A or B wait for the full
          packing list.
        </p>
      )}
    </div>
  );
}

/** Reads one box per grade of each cell; nothing typed is 0. */
function readGrades<K extends string>(
  form: FormData,
  box: string,
  cells: Array<Pick<Cell, "colorName" | "sizeName">>,
  grades: ReadonlyArray<{ key: K; label: string }>,
  most?: (i: number) => number | null,
) {
  const lines: Array<{ colorName: string | null; sizeName: string | null } & Record<K, number>> =
    [];
  const sent: number[] = [];
  const fieldErrors: Record<string, string[]> = {};
  cells.forEach((c, i) => {
    const values = {} as Record<K, number>;
    let total = 0;
    for (const g of grades) {
      const n = readPieces(String(form.get(`${box}.${i}.${g.key}`) ?? ""));
      if (n === null) fieldErrors[`${box}.${i}`] = ["Whole pieces only"];
      values[g.key] = n ?? 0;
      total += n ?? 0;
    }
    const limit = most?.(i) ?? null;
    if (!fieldErrors[`${box}.${i}`] && limit !== null && total > limit) {
      fieldErrors[`${box}.${i}`] = [`No more than ${limit} in all`];
    }
    if (total > 0) {
      lines.push({ colorName: c.colorName, sizeName: c.sizeName, ...values });
      sent.push(i);
    }
  });
  if (Object.keys(fieldErrors).length === 0 && lines.length === 0) {
    fieldErrors.lines = ["Enter the pieces of at least one colour and size."];
  }
  const error: ActionError | undefined =
    Object.keys(fieldErrors).length > 0
      ? { code: "VALIDATION", message: "Check the pieces", fieldErrors }
      : undefined;
  return { lines, sent, error };
}

/** Moves the service's "lines.N" errors to the row they came from. */
export function remapGradeLines(error: ActionError, sent: number[], box: string): ActionError {
  if (!error.fieldErrors) return error;
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(error.fieldErrors)) {
    const index = /^(?:lines|missing)\.(\d+)$/.exec(key)?.[1];
    const from = index === undefined ? undefined : sent[Number(index)];
    fieldErrors[from === undefined ? key : `${box}.${from}`] = value;
  }
  return { ...error, fieldErrors };
}

/**
 * Receive Full Packing List: what goes to stock, the missing pieces (filled
 * with what was cut and never counted), the warehouse, the packing list's
 * photo, and (for Production Managers) closing the style.
 */
function PackingListDialog({
  screen,
  currency,
  onClose,
  onDone,
}: {
  screen: FinishingScreen;
  currency: string;
  onClose: () => void;
  onDone: (query: string) => void;
}) {
  const { project: p, totals, packed, can, cost } = screen;
  const [closeStyle, setCloseStyle] = useState(false);
  const [zeroCost, setZeroCost] = useState(false);
  // Missing pieces are asked for on the first, full packing list only.
  const missingCells = packed
    ? []
    : screen.cells.filter((c) => c.notCounted === null || c.notCounted > 0);
  const noCost = cost !== null && Number(cost.total) === 0;
  const toStock = totals.toStock.a + totals.toStock.b;
  return (
    <FormDialog
      title={packed ? "Move mended pieces to stock" : "Receive Full Packing List"}
      description={
        <>
          {toStock > 0
            ? `${pieces(totals.toStock.a, currency)} A-grade and ${pieces(totals.toStock.b, currency)} B-grade go to the Sales stock on one delivery.`
            : "Every A and B piece counted is in stock already."}{" "}
          C-grade (mending) pieces, rejects and missing pieces stay out of stock.
        </>
      }
      submitLabel={packed ? "Move them to stock" : "Receive the packing list"}
      pendingLabel="Receiving"
      errorTitle="We could not receive the packing list"
      className="sm:max-w-xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const fieldErrors: Record<string, string[]> = {};
        const missing: Array<{
          colorName: string | null;
          sizeName: string | null;
          quantity: number;
        }> = [];
        const sent: number[] = [];
        missingCells.forEach((c, i) => {
          const n = readPieces(String(form.get(`missing.${i}`) ?? ""));
          if (n === null) fieldErrors[`missing.${i}`] = ["Whole pieces only"];
          else if (c.notCounted !== null && n > c.notCounted) {
            fieldErrors[`missing.${i}`] = [`No more than ${c.notCounted}`];
          } else if (n > 0) {
            missing.push({ colorName: c.colorName, sizeName: c.sizeName, quantity: n });
            sent.push(i);
          }
        });
        const file = form.get("file");
        if (file instanceof File && file.size > MAX_FILE_BYTES) {
          fieldErrors.file = ["Files can be up to 10 MB."];
        }
        if (Object.keys(fieldErrors).length > 0) {
          return { code: "VALIDATION", message: "Check the packing list", fieldErrors };
        }
        let fileId: string | null = null;
        if (file instanceof File && file.size > 0) {
          const upload = new FormData();
          upload.set("file", file);
          const stored = await uploadProductionFileAction(upload);
          if (!stored.ok) return { ...stored.error, fieldErrors: { file: [stored.error.message] } };
          fileId = stored.data.id;
        }
        const result = await receivePackingListAction(p.id, {
          countedOn: String(form.get("countedOn") ?? "") || undefined,
          missing,
          warehouseId: String(form.get("warehouseId") ?? "") || null,
          closeStyle,
          allowZeroCost: zeroCost,
          fileId,
          note: String(form.get("note") ?? "").trim() || null,
        });
        if (!result.ok) return remapGradeLines(result.error, sent, "missing");
        const r = result.data;
        const query = new URLSearchParams({
          packed: r.number,
          a: String(r.a),
          b: String(r.b),
          missing: String(r.missing),
          ...(r.intake ? { delivery: r.intake.number } : {}),
          ...(r.fault ? { fault: r.fault.number } : {}),
          ...(r.closed ? { closed: "1" } : {}),
        });
        onDone(query.toString());
      }}
    >
      {(fieldError) => (
        <>
          <Field id="packed-day" label="Received on" error={fieldError("countedOn")}>
            <Input
              id="packed-day"
              name="countedOn"
              type="date"
              max={screen.today}
              defaultValue={screen.today}
            />
          </Field>
          {missingCells.length > 0 && (
            <div className="grid gap-2">
              <PieceBoxes
                box="missing"
                lines={missingCells}
                legend="Missing (lost or stolen)"
                hint={(i) => {
                  const n = missingCells[i]!.notCounted;
                  return n === null ? "No cutting recorded" : `${n} cut and not counted`;
                }}
                defaults={(i) => String(missingCells[i]!.notCounted ?? "")}
                fieldError={fieldError}
              />
              <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                Pieces cut and never counted are missing.{" "}
                {p.factoryInLog
                  ? `They go into ${p.factory}'s fault log at the final unit cost, to deduct from the CM.`
                  : "The factory is not a supplier in the app, so they are only kept here."}{" "}
                Set a box to 0 for pieces still to come.
              </p>
            </div>
          )}
          {screen.warehouses.length > 1 && (
            <Field id="packed-warehouse" label="Into the warehouse">
              <NativeSelect
                id="packed-warehouse"
                name="warehouseId"
                defaultValue={screen.defaultWarehouseId ?? undefined}
              >
                {screen.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field
            id="packed-file"
            label="The factory's packing list (optional)"
            hint="A photo or PDF, kept with the delivery. Up to 10 MB."
            error={fieldError("file")}
          >
            <Input
              id="packed-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="h-auto py-1.5 file:mr-3"
            />
          </Field>
          <Field id="packed-note" label="Notes (optional)">
            <Textarea id="packed-note" name="note" rows={2} maxLength={1000} />
          </Field>
          {noCost && (
            <div className="flex items-start gap-3">
              <Checkbox
                id="packed-zero"
                checked={zeroCost}
                onCheckedChange={(v) => setZeroCost(v === true)}
                className="mt-0.5"
              />
              <label htmlFor="packed-zero" className="text-sm leading-snug">
                No cost is recorded on {p.code} yet: take the pieces in at no cost
              </label>
            </div>
          )}
          {can.close && !packed && (
            <div className="flex items-start gap-3">
              <Checkbox
                id="packed-close"
                checked={closeStyle}
                onCheckedChange={(v) => setCloseStyle(v === true)}
                className="mt-0.5"
              />
              <label htmlFor="packed-close" className="text-sm leading-snug">
                Close the style now: every piece in stock then costs the final unit cost, total cost
                ÷ (A + B)
              </label>
            </div>
          )}
        </>
      )}
    </FormDialog>
  );
}

/** Counts, mending returns and packing lists, newest first. */
export function FinishingReports({
  screen,
  currency,
}: {
  screen: FinishingScreen;
  currency: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<Report | null>(null);
  const { reports, can } = screen;
  return (
    <Panel title="Finishing reports" id="finishing-reports-heading">
      {reports.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          No finishing counts yet. Each count grades pieces A, B or C (mending), with rejects apart.
        </p>
      ) : (
        <ul className="mt-4 grid divide-y" aria-label="Finishing reports">
          {reports.map((r) => (
            <li key={r.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{r.number}</span>
                <StatusBadge tone={r.kind === "PACKING_LIST" ? "done" : "plain"}>
                  {REPORT_KIND_LABELS[r.kind]}
                </StatusBadge>
                {!r.stands && <StatusBadge tone="closed">Undone</StatusBadge>}
                <span className="text-[0.8125rem] text-muted-foreground">{formatDay(r.on)}</span>
              </div>
              <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                {reportLine(r, currency)}
              </p>
              {r.kind !== "PACKING_LIST" && r.lines.length > 0 && (
                <p className="text-[0.75rem] text-muted-foreground">
                  {r.lines
                    .map((l) =>
                      [
                        cellName(l),
                        [
                          l.a && `A ${l.a}`,
                          l.b && `B ${l.b}`,
                          l.c > 0 && `C ${l.c}`,
                          l.reject && `reject ${l.reject}`,
                        ]
                          .filter(Boolean)
                          .join(", "),
                      ].join(": "),
                    )
                    .join(" · ")}
                </p>
              )}
              {(r.intake || r.fault) && (
                <p className="text-[0.8125rem]">
                  {r.intake && (
                    <Link href={productionHref.delivery(r.intake.id)} className={linkClass}>
                      {r.intake.number}
                    </Link>
                  )}
                  {r.intake && r.fault && " · "}
                  {r.fault && (
                    <Link
                      href={productionHref.faults({ batchId: screen.project.batch?.id })}
                      className={linkClass}
                    >
                      {r.fault.number} in the fault log
                    </Link>
                  )}
                </p>
              )}
              {r.note && <p className="text-sm">{r.note}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[0.75rem] text-muted-foreground">
                  {r.by ? `by ${r.by}` : ""}
                </span>
                <div className="flex flex-wrap gap-2">
                  {r.fileId && (
                    <a
                      href={productionHref.file(r.fileId)}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center gap-1.5 text-[0.8125rem] ${linkClass}`}
                    >
                      <PaperclipIcon className="size-3.5" aria-hidden />
                      {r.kind === "PACKING_LIST" ? "The packing list" : "Photo of the QC sheet"}
                    </a>
                  )}
                  {can.deleteReports && r.kind !== "PACKING_LIST" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(r)}
                      aria-label={`Delete ${r.number}`}
                    >
                      <Trash2Icon aria-hidden />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.number}?`}
          description="Its pieces come off the grades. Counts stay once the full packing list is received."
          confirmLabel="Delete the report"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the report"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await deleteFinishingReportAction(deleting.id);
            if (!result.ok) return result.error;
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </Panel>
  );
}

function reportLine(r: Report, currency: string) {
  const t = r.totals;
  if (r.kind === "PACKING_LIST") {
    return t.missing > 0 ? `${pieces(t.missing, currency)} missing` : "Nothing missing";
  }
  if (r.kind === "MENDING") {
    return `${pieces(t.a + t.b + t.reject, currency)} back: A ${t.a} · B ${t.b} · reject ${t.reject}`;
  }
  return `A ${formatCount(t.a, currency)} · B ${formatCount(t.b, currency)} · C ${formatCount(t.c, currency)} · reject ${formatCount(t.reject, currency)}`;
}
