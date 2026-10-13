"use client";

import {
  CalendarClockIcon,
  PackageCheckIcon,
  PaperclipIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SendIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { readQuantity, UNIT_LABELS } from "@/components/materials/labels";
import { SupplierPicker } from "@/components/materials/pickers";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { CuttingScreen } from "@/modules/production/cutting.service";
import {
  deleteCuttingReportAction,
  fabricFaultNoteAction,
  receiveFromEmbroideryAction,
  replaceFromCuttingAction,
  sendToEmbroideryAction,
  setMilestonesAction,
  uploadFaultPhotoAction,
} from "@/server/actions/production.actions";

import { cellName } from "./cutting-summary";
import { pieces, productionHref } from "./labels";

/*
 * What a Production Manager does on a style's cutting page: send cut pieces
 * out for embroidery or print, take them back (and cut the spoiled ones again
 * at once), set the cutting and sewing dates, log a Fabric Fault Note, and
 * delete a cutting report entered by mistake.
 */

type Job = CuttingScreen["jobs"][number];
type Report = CuttingScreen["reports"][number];
type Line = { colorName: string | null; sizeName: string | null };
type Supplier = { id: string; code: string; name: string };

const linkClass = "text-primary underline-offset-4 hover:underline";
const KIND_LABELS = { EMBROIDERY: "Embroidery", PRINT: "Print" } as const;

/** Whole pieces typed in a box: 0 when empty, null when not a whole number. */
export function readPieces(text: string): number | null {
  const value = text.trim().replace(/,/g, "");
  if (!value) return 0;
  return /^\d+$/.test(value) && Number(value) <= 1_000_000 ? Number(value) : null;
}

/**
 * The service names a line's error by its place in what was sent
 * ("lines.1"); this moves it to the box it came from ("send.4").
 */
export function remapLines(error: ActionError, sent: number[], box: string): ActionError {
  if (!error.fieldErrors) return error;
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(error.fieldErrors)) {
    const index = /^lines\.(\d+)$/.exec(key)?.[1];
    const from = index === undefined ? undefined : sent[Number(index)];
    fieldErrors[from === undefined ? key : `${box}.${from}`] = value;
  }
  return { ...error, fieldErrors };
}

/** Boxes of pieces, one per colour and size, as the dialogs read them. */
export function readBoxes(
  form: FormData,
  box: string,
  lines: Line[],
  most: (i: number) => number,
): { lines: Array<Line & { quantity: number }>; sent: number[]; error?: ActionError } {
  const out: Array<Line & { quantity: number }> = [];
  const sent: number[] = [];
  const fieldErrors: Record<string, string[]> = {};
  lines.forEach((l, i) => {
    const n = readPieces(String(form.get(`${box}.${i}`) ?? ""));
    if (n === null) fieldErrors[`${box}.${i}`] = ["Whole pieces only"];
    else if (n > most(i)) fieldErrors[`${box}.${i}`] = [`No more than ${most(i)}`];
    else if (n > 0) {
      out.push({ colorName: l.colorName, sizeName: l.sizeName, quantity: n });
      sent.push(i);
    }
  });
  if (Object.keys(fieldErrors).length === 0 && out.length === 0) {
    fieldErrors.lines = ["Enter the pieces of at least one colour and size."];
  }
  return Object.keys(fieldErrors).length > 0
    ? { lines: out, sent, error: { code: "VALIDATION", message: "Check the pieces", fieldErrors } }
    : { lines: out, sent };
}

export function PieceBoxes({
  box,
  lines,
  hint,
  defaults,
  fieldError,
  legend,
}: {
  box: string;
  lines: Line[];
  hint: (i: number) => string;
  defaults?: (i: number) => string;
  fieldError: (name: string) => string | undefined;
  legend: string;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {lines.map((l, i) => (
          <Field
            key={`${l.colorName}|${l.sizeName}`}
            id={`${box}-${i}`}
            label={cellName(l)}
            hint={hint(i)}
            error={fieldError(`${box}.${i}`)}
          >
            <Input
              id={`${box}-${i}`}
              name={`${box}.${i}`}
              inputMode="numeric"
              autoComplete="off"
              defaultValue={defaults?.(i)}
              aria-invalid={Boolean(fieldError(`${box}.${i}`))}
            />
          </Field>
        ))}
      </div>
      {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
    </fieldset>
  );
}

type Dialog = "send" | "dates" | "fault" | null;

/** The buttons above the cutting page, and their windows. */
export function CuttingActions({ screen, currency }: { screen: CuttingScreen; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<Dialog>(null);
  const { project: p, can } = screen;
  const here = productionHref.cutting(p.id);
  const free = screen.cells
    .map((c) => ({ colorName: c.colorName, sizeName: c.sizeName, free: c.cut - c.sent }))
    .filter((c) => c.free > 0);
  if (!can.record && !can.faultNote) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {can.record && (
        <>
          <Button asChild size="sm">
            <Link href={productionHref.newCutting(p.id)}>
              <ScissorsIcon aria-hidden />
              New cutting report
            </Link>
          </Button>
          {free.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen("send")}>
              <SendIcon aria-hidden />
              Send for embroidery or print
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen("dates")}>
            <CalendarClockIcon aria-hidden />
            Cutting and sewing dates
          </Button>
        </>
      )}
      {can.faultNote && screen.fabrics.length > 0 && (
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen("fault")}>
          <ShieldAlertIcon aria-hidden />
          Fabric Fault Note
        </Button>
      )}

      {open === "send" && (
        <FormDialog
          title="Send for embroidery or print"
          description="Cut pieces going out, by colour and size: no more than is cut and not already out."
          submitLabel="Send the pieces"
          pendingLabel="Sending"
          errorTitle="We could not send the pieces"
          onClose={() => setOpen(null)}
          onSubmit={async (form) => {
            const read = readBoxes(form, "send", free, (i) => free[i]!.free);
            if (read.error) return read.error;
            const text = (name: string) => String(form.get(name) ?? "").trim();
            const result = await sendToEmbroideryAction(p.id, {
              kind: text("kind"),
              partyId: text("partyId") || null,
              sentOn: text("sentOn") || undefined,
              dueOn: text("dueOn") || null,
              lines: read.lines,
              note: text("note") || null,
            });
            if (!result.ok) return remapLines(result.error, read.sent, "send");
            setOpen(null);
            router.push(`${here}?sent=${encodeURIComponent(result.data.number)}`);
          }}
        >
          {(fieldError) => <SendFields screen={screen} free={free} fieldError={fieldError} />}
        </FormDialog>
      )}

      {open === "dates" && (
        <FormDialog
          title="Cutting and sewing dates"
          description={`The style and its batch warn three days before a date and once it has passed. The target day is ${formatDay(p.targetOn)}.`}
          submitLabel="Save the dates"
          pendingLabel="Saving"
          errorTitle="We could not save the dates"
          onClose={() => setOpen(null)}
          onSubmit={async (form) => {
            const text = (name: string) => String(form.get(name) ?? "").trim();
            const result = await setMilestonesAction(p.id, {
              cutBy: text("cutBy") || null,
              sewBy: text("sewBy") || null,
            });
            if (!result.ok) return result.error;
            setOpen(null);
            router.push(`${here}?dates=1`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field id="cut-by" label="Cutting done by" error={fieldError("cutBy")}>
                <Input
                  id="cut-by"
                  name="cutBy"
                  type="date"
                  max={p.targetOn}
                  defaultValue={p.cutBy ?? ""}
                />
              </Field>
              <Field id="sew-by" label="Sewing done by" error={fieldError("sewBy")}>
                <Input
                  id="sew-by"
                  name="sewBy"
                  type="date"
                  max={p.targetOn}
                  defaultValue={p.sewBy ?? ""}
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {open === "fault" && (
        <FabricFaultDialog
          screen={screen}
          currency={currency}
          onClose={() => setOpen(null)}
          onDone={(number) => {
            setOpen(null);
            router.push(`${here}?fault=${encodeURIComponent(number)}`);
          }}
        />
      )}
    </div>
  );
}

function SendFields({
  screen,
  free,
  fieldError,
}: {
  screen: CuttingScreen;
  free: Array<Line & { free: number }>;
  fieldError: (name: string) => string | undefined;
}) {
  const [party, setParty] = useState<Supplier | null>(null);
  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="send-kind" label="For">
          <NativeSelect id="send-kind" name="kind" defaultValue="EMBROIDERY">
            <option value="EMBROIDERY">Embroidery</option>
            <option value="PRINT">Print</option>
          </NativeSelect>
        </Field>
        <Field id="send-party" label="Embroidery or print house (optional)">
          <SupplierPicker id="send-party" value={party} onChange={setParty} />
          <input type="hidden" name="partyId" value={party?.id ?? ""} />
        </Field>
        <Field id="send-day" label="Sent on" error={fieldError("sentOn")}>
          <Input
            id="send-day"
            name="sentOn"
            type="date"
            max={screen.today}
            defaultValue={screen.today}
          />
        </Field>
        <Field id="send-due" label="Due back (optional)" error={fieldError("dueOn")}>
          <Input id="send-due" name="dueOn" type="date" min={screen.today} />
        </Field>
      </div>
      <PieceBoxes
        box="send"
        legend="Pieces to send"
        lines={free}
        hint={(i) => `${free[i]!.free} free to send`}
        fieldError={fieldError}
      />
      <Field id="send-note" label="Note (optional)">
        <Textarea id="send-note" name="note" rows={2} maxLength={1000} />
      </Field>
    </>
  );
}

/** The Fabric Fault Note: faulty fabric found at cutting, with a photo, into the fault log. */
function FabricFaultDialog({
  screen,
  currency,
  onClose,
  onDone,
}: {
  screen: CuttingScreen;
  currency: string;
  onClose: () => void;
  onDone: (number: string) => void;
}) {
  const [fabricId, setFabricId] = useState(screen.fabrics[0]!.id);
  const fabric = screen.fabrics.find((f) => f.id === fabricId)!;
  const [supplier, setSupplier] = useState<Supplier | null>(fabric.supplier);
  return (
    <FormDialog
      title="Fabric Fault Note"
      description="Faulty fabric found at cutting (holes, shade, stains) goes into the supplier's fault log, to take off their next payment."
      submitLabel="Log the Fabric Fault Note"
      pendingLabel="Logging"
      errorTitle="We could not log the Fabric Fault Note"
      onClose={onClose}
      onSubmit={async (form) => {
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const fieldErrors: Record<string, string[]> = {};
        if (!supplier) fieldErrors.supplierId = ["Choose who it is against"];
        const quantity = readQuantity(text("quantity"), fabric.unit);
        if (typeof quantity === "string") fieldErrors.quantity = [quantity];
        const amount = text("amount") ? Number(text("amount").replace(/,/g, "")) : null;
        if (amount !== null && !(amount >= 0)) fieldErrors.amount = ["Enter an amount"];
        if (Object.keys(fieldErrors).length > 0) {
          return { code: "VALIDATION", message: "Check the fields", fieldErrors };
        }
        let photoId: string | null = null;
        const photo = form.get("photo");
        if (photo instanceof File && photo.size > 0) {
          const upload = new FormData();
          upload.set("file", photo);
          const stored = await uploadFaultPhotoAction(upload);
          if (!stored.ok) {
            return { ...stored.error, fieldErrors: { photo: [stored.error.message] } };
          }
          photoId = stored.data.id;
        }
        const result = await fabricFaultNoteAction(screen.project.id, {
          materialId: fabric.id,
          supplierId: supplier!.id,
          quantity,
          amount,
          photoId,
          note: text("note"),
        });
        if (!result.ok) return result.error;
        onDone(result.data.number);
      }}
    >
      {(fieldError) => (
        <>
          <Field id="ff-fabric" label="Fabric">
            <NativeSelect
              id="ff-fabric"
              name="materialId"
              value={fabricId}
              onChange={(e) => {
                const next = screen.fabrics.find((f) => f.id === e.target.value)!;
                setFabricId(next.id);
                setSupplier(next.supplier);
              }}
            >
              {screen.fabrics.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="ff-supplier" label="Supplier" error={fieldError("supplierId")}>
            <SupplierPicker
              id="ff-supplier"
              value={supplier}
              onChange={setSupplier}
              invalid={Boolean(fieldError("supplierId"))}
            />
          </Field>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field
              id="ff-quantity"
              label={`Faulty fabric (${UNIT_LABELS[fabric.unit]})`}
              error={fieldError("quantity")}
            >
              <Input id="ff-quantity" name="quantity" inputMode="decimal" autoComplete="off" />
            </Field>
            {screen.can.seeValues && (
              <Field
                id="ff-amount"
                label={`Value to deduct (${currency}, optional)`}
                error={fieldError("amount")}
              >
                <Input id="ff-amount" name="amount" inputMode="decimal" autoComplete="off" />
              </Field>
            )}
          </div>
          <Field
            id="ff-photo"
            label="Photo (optional)"
            hint="Kept with the fault. JPG, PNG, WebP or PDF, up to 10 MB."
            error={fieldError("photo")}
          >
            <Input
              id="ff-photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="h-auto py-1.5 file:mr-3"
            />
          </Field>
          <Field id="ff-note" label="What is wrong" error={fieldError("note")}>
            <Textarea id="ff-note" name="note" rows={3} maxLength={1000} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** "Navy M 40 · Navy L 20" (nothing for a style without colours and sizes). */
function linesText(lines: Array<Line & { quantity: number }>) {
  if (lines.every((l) => !l.colorName && !l.sizeName)) return null;
  return lines.map((l) => `${cellName(l)} ${l.quantity}`).join(" · ");
}

/** The style's cutting reports, newest first; one entered by mistake can be deleted. */
export function CuttingReports({ screen, currency }: { screen: CuttingScreen; currency: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<Report | null>(null);
  return (
    <Panel title="Cutting reports" id="cut-reports-heading">
      {screen.reports.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No cutting report yet.</p>
      ) : (
        <ul aria-label="Cutting reports" className="mt-4 grid divide-y">
          {screen.reports.map((r) => (
            <li key={r.id} className="grid min-w-0 gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{r.number}</span>
                {r.kind === "REPLACEMENT" && <StatusBadge tone="plain">Replacement</StatusBadge>}
                {r.readByAi && <StatusBadge tone="open">Read by AI</StatusBadge>}
                <span className="text-[0.8125rem] text-muted-foreground">{formatDay(r.cutOn)}</span>
                <span className="ml-auto text-sm tabular-nums">{pieces(r.pieces, currency)}</span>
              </div>
              {linesText(r.lines) && (
                <p className="text-[0.8125rem] break-words text-muted-foreground tabular-nums">
                  {linesText(r.lines)}
                </p>
              )}
              <p className="text-[0.8125rem] break-words text-muted-foreground">
                {[
                  r.fabricUsed.length > 0 &&
                    `Fabric used: ${r.fabricUsed.map((f) => `${f.code} ${f.quantity} ${UNIT_LABELS[f.unit]}`).join(", ")}`,
                  r.forJob && `for pieces spoiled on ${r.forJob}`,
                  r.by && `by ${r.by}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {r.note && r.kind === "CUT" && (
                <p className="text-[0.8125rem] break-words whitespace-pre-line">{r.note}</p>
              )}
              {(r.photoId || screen.can.record) && (
                <div className="flex flex-wrap items-center gap-3">
                  {r.photoId && (
                    <a
                      href={productionHref.file(r.photoId)}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex items-center gap-1.5 text-[0.8125rem] ${linkClass}`}
                    >
                      <PaperclipIcon className="size-3.5" aria-hidden />
                      Photo of the sheet
                    </a>
                  )}
                  {screen.can.record && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2Icon aria-hidden />
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.number}?`}
          description="Its pieces come off what was cut. A report whose pieces went out for embroidery or print cannot be deleted."
          confirmLabel="Delete the report"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the report"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await deleteCuttingReportAction(deleting.id);
            if (!result.ok) return result.error;
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </Panel>
  );
}

type Replacing = { job: Job; spoiledNow: number };

/** Pieces out for embroidery or print, taking them back, and cutting the spoiled ones again. */
export function EmbroideryJobs({ screen, currency }: { screen: CuttingScreen; currency: string }) {
  const router = useRouter();
  const [receiving, setReceiving] = useState<Job | null>(null);
  const [replacing, setReplacing] = useState<Replacing | null>(null);
  const here = productionHref.cutting(screen.project.id);
  const can = screen.can.record;
  return (
    <Panel title="Embroidery and print" id="cut-jobs-heading">
      {screen.jobs.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          No pieces sent out yet. Pieces that come back spoiled are cut again at once.
        </p>
      ) : (
        <ul aria-label="Embroidery and print jobs" className="mt-4 grid divide-y">
          {screen.jobs.map((j) => (
            <li key={j.id} className="grid min-w-0 gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{j.number}</span>
                <StatusBadge tone="plain">{KIND_LABELS[j.kind]}</StatusBadge>
                {j.late && <StatusBadge tone="warn">Late</StatusBadge>}
                {j.receivedOn && <StatusBadge tone="done">All back</StatusBadge>}
              </div>
              <p className="text-sm break-words">
                {j.party?.name ?? "No house given"}
                <span className="text-muted-foreground">
                  {" "}
                  · sent {formatDay(j.sentOn)}
                  {j.dueOn && ` · due ${formatDay(j.dueOn)}`}
                  {j.receivedOn && ` · all back ${formatDay(j.receivedOn)}`}
                </span>
              </p>
              <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                {[
                  `${pieces(j.sent, currency)} sent`,
                  `${j.back} back`,
                  j.spoiled > 0 && `${j.spoiled} spoiled`,
                  j.out > 0 && `${j.out} still out`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {j.toReplace > 0 && (
                <p className="text-[0.8125rem] text-destructive">
                  {j.toReplace} spoiled {j.toReplace === 1 ? "piece" : "pieces"} still to replace
                  from cutting.
                </p>
              )}
              {can && (j.out > 0 || j.toReplace > 0) && (
                <div className="flex flex-wrap gap-2">
                  {j.out > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReceiving(j)}
                    >
                      <PackageCheckIcon aria-hidden />
                      Receive back
                    </Button>
                  )}
                  {j.toReplace > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setReplacing({ job: j, spoiledNow: 0 })}
                    >
                      <RefreshCwIcon aria-hidden />
                      Replace from cutting
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {receiving && (
        <ReceiveDialog
          job={receiving}
          today={screen.today}
          onClose={() => setReceiving(null)}
          onDone={(back) => {
            setReceiving(null);
            if (back.spoiled > 0) {
              // "Replace from cutting immediately": straight on to cutting them again.
              setReplacing({
                job: {
                  ...receiving,
                  toReplaceLines: mergeLines(receiving.toReplaceLines, back.spoiledLines),
                },
                spoiledNow: back.spoiled,
              });
              router.refresh();
            } else {
              router.push(`${here}?back=${encodeURIComponent(receiving.number)}&good=${back.good}`);
            }
          }}
        />
      )}
      {replacing && (
        <ReplaceDialog
          replacing={replacing}
          today={screen.today}
          canLogFault={screen.can.faultNote}
          onClose={() => setReplacing(null)}
          onDone={(done) => {
            setReplacing(null);
            router.push(
              `${here}?replaced=${encodeURIComponent(done.number)}&pieces=${done.pieces}${
                done.fault ? `&logged=${encodeURIComponent(done.fault.number)}` : ""
              }`,
            );
          }}
        />
      )}
    </Panel>
  );
}

/** Spoiled lines still to replace with the ones that just came back spoiled. */
function mergeLines(
  before: Array<Line & { quantity: number }>,
  now: Array<Line & { quantity: number }>,
) {
  const all = before.map((l) => ({ ...l }));
  for (const l of now) {
    const same = all.find((x) => x.colorName === l.colorName && x.sizeName === l.sizeName);
    if (same) same.quantity += l.quantity;
    else all.push({ ...l });
  }
  return all;
}

function ReceiveDialog({
  job,
  today,
  onClose,
  onDone,
}: {
  job: Job;
  today: string;
  onClose: () => void;
  onDone: (back: {
    good: number;
    spoiled: number;
    spoiledLines: Array<Line & { quantity: number }>;
  }) => void;
}) {
  const out = job.lines
    .map((l) => ({ ...l, out: l.sent - l.received - l.spoiled }))
    .filter((l) => l.out > 0);
  return (
    <FormDialog
      title={`Receive back on ${job.number}`}
      description={`Pieces back from ${job.party?.name ?? "the house"}: good ones, and spoiled ones to cut again. Some can come back later.`}
      submitLabel="Take them back"
      pendingLabel="Saving"
      errorTitle="We could not take the pieces back"
      onClose={onClose}
      onSubmit={async (form) => {
        const lines: Array<Line & { received: number; spoiled: number }> = [];
        const sent: number[] = [];
        const fieldErrors: Record<string, string[]> = {};
        out.forEach((l, i) => {
          const good = readPieces(String(form.get(`good.${i}`) ?? ""));
          const bad = readPieces(String(form.get(`spoiled.${i}`) ?? ""));
          if (good === null) fieldErrors[`good.${i}`] = ["Whole pieces only"];
          if (bad === null) fieldErrors[`spoiled.${i}`] = ["Whole pieces only"];
          if (good === null || bad === null) return;
          if (good + bad > l.out) fieldErrors[`good.${i}`] = [`Only ${l.out} still out`];
          else if (good + bad > 0) {
            lines.push({
              colorName: l.colorName,
              sizeName: l.sizeName,
              received: good,
              spoiled: bad,
            });
            sent.push(i);
          }
        });
        if (Object.keys(fieldErrors).length === 0 && lines.length === 0) {
          fieldErrors.lines = ["Enter the pieces that came back."];
        }
        if (Object.keys(fieldErrors).length > 0) {
          return { code: "VALIDATION", message: "Check the pieces", fieldErrors };
        }
        const result = await receiveFromEmbroideryAction(job.id, {
          receivedOn: String(form.get("receivedOn") ?? "") || undefined,
          lines,
        });
        if (!result.ok) return remapLines(result.error, sent, "good");
        onDone(result.data);
      }}
    >
      {(fieldError) => (
        <>
          <Field id="back-day" label="Back on" error={fieldError("receivedOn")}>
            <Input id="back-day" name="receivedOn" type="date" max={today} defaultValue={today} />
          </Field>
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Pieces back</legend>
            {out.map((l, i) => (
              <div key={`${l.colorName}|${l.sizeName}`} className="grid gap-2">
                <p className="text-sm">
                  <span className="font-medium">{cellName(l)}</span>
                  <span className="text-muted-foreground"> · {l.out} still out</span>
                </p>
                <div className="grid grid-cols-2 items-start gap-3">
                  <Field id={`back-${i}-good`} label="Good" error={fieldError(`good.${i}`)}>
                    <Input
                      id={`back-${i}-good`}
                      name={`good.${i}`}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    id={`back-${i}-spoiled`}
                    label="Spoiled"
                    error={fieldError(`spoiled.${i}`)}
                  >
                    <Input
                      id={`back-${i}-spoiled`}
                      name={`spoiled.${i}`}
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </Field>
                </div>
              </div>
            ))}
            {fieldError("lines") && <FormAlert>{fieldError("lines")}</FormAlert>}
          </fieldset>
        </>
      )}
    </FormDialog>
  );
}

function ReplaceDialog({
  replacing: { job, spoiledNow },
  today,
  canLogFault,
  onClose,
  onDone,
}: {
  replacing: Replacing;
  today: string;
  canLogFault: boolean;
  onClose: () => void;
  onDone: (done: { number: string; pieces: number; fault: { number: string } | null }) => void;
}) {
  const lines = job.toReplaceLines;
  const [logFault, setLogFault] = useState(false);
  return (
    <FormDialog
      title={spoiledNow > 0 ? "Replace from cutting immediately?" : "Replace from cutting"}
      description={
        spoiledNow > 0
          ? `${spoiledNow} ${spoiledNow === 1 ? "piece" : "pieces"} came back spoiled from ${job.number}. Cut them again now so the order stays complete.`
          : `Cut the pieces spoiled on ${job.number} again. Production is alerted at once.`
      }
      submitLabel="Cut them again"
      pendingLabel="Saving"
      errorTitle="We could not record the replacement"
      onClose={onClose}
      onSubmit={async (form) => {
        const read = readBoxes(form, "replace", lines, (i) => lines[i]!.quantity);
        if (read.error) return read.error;
        const result = await replaceFromCuttingAction(job.id, {
          cutOn: String(form.get("cutOn") ?? "") || undefined,
          lines: read.lines,
          logFault,
        });
        if (!result.ok) return remapLines(result.error, read.sent, "replace");
        onDone(result.data);
      }}
    >
      {(fieldError) => (
        <>
          <Field id="replace-day" label="Cut on" error={fieldError("cutOn")}>
            <Input id="replace-day" name="cutOn" type="date" max={today} defaultValue={today} />
          </Field>
          <PieceBoxes
            box="replace"
            legend="Pieces to cut again"
            lines={lines}
            hint={(i) => `${lines[i]!.quantity} spoiled`}
            defaults={(i) => String(lines[i]!.quantity)}
            fieldError={fieldError}
          />
          {job.party && canLogFault && (
            <div className="flex items-start gap-3">
              <Checkbox
                id="replace-fault"
                checked={logFault}
                onCheckedChange={(v) => setLogFault(v === true)}
                className="mt-0.5"
              />
              <label htmlFor="replace-fault" className="text-sm leading-snug">
                Also log the spoiled pieces in {job.party.name}&apos;s fault log
              </label>
            </div>
          )}
        </>
      )}
    </FormDialog>
  );
}
