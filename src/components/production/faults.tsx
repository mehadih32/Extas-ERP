"use client";

import type { SupplierFaultKind, SupplierFaultStatus } from "@prisma/client";
import {
  BadgeCheckIcon,
  FileDownIcon,
  PaperclipIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  UndoDotIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { quantity as quantityText } from "@/components/materials/labels";
import { SupplierPicker } from "@/components/materials/pickers";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { FaultItem, FaultList as FaultListData } from "@/modules/production/fault.service";
import {
  createFaultAction,
  settleFaultAction,
  uploadFaultPhotoAction,
} from "@/server/actions/production.actions";

import { FAULT_KIND_LABELS, FAULT_STATUS_LABELS, productionHref } from "./labels";

const linkClass = "text-primary underline-offset-4 hover:underline";
const KINDS: SupplierFaultKind[] = [
  "SHORT_RECEIVE",
  "FABRIC_FAULT",
  "QUALITY",
  "MISSING_PIECES",
  "SPOILED_PIECES",
  "OTHER",
];
const STATUS_TONES: Record<SupplierFaultStatus, Tone> = {
  OPEN: "warn",
  DEDUCTED: "done",
  WAIVED: "closed",
};

type Can = FaultListData["can"];
type Supplier = { id: string; code: string; name: string };

export function FaultStatusBadge({ status }: { status: SupplierFaultStatus }) {
  return <StatusBadge tone={STATUS_TONES[status]}>{FAULT_STATUS_LABELS[status]}</StatusBadge>;
}

/** What the fault is about: its batch, style and material, as links where they go. */
function forText(f: FaultItem) {
  return [
    f.batch?.code,
    f.project?.code,
    f.material ? `${f.material.code} ${f.material.name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One fault: what, whose, how much, its value to deduct, and (for those who may) settle it. */
function FaultCard({ fault: f, can, currency }: { fault: FaultItem; can: Can; currency: string }) {
  const about = forText(f);
  return (
    <li className="grid min-w-0 gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{f.number}</span>
        <FaultStatusBadge status={f.status} />
        <span className="text-[0.8125rem] text-muted-foreground">
          {FAULT_KIND_LABELS[f.kind]} · {formatDay(f.occurredOn)}
        </span>
      </div>
      <p className="text-sm break-words">
        <span className="font-medium">{f.supplier.name}</span>
        {about && <span className="text-muted-foreground"> · {about}</span>}
      </p>
      <p className="text-[0.8125rem] leading-relaxed break-words text-muted-foreground">{f.note}</p>
      <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
        {[
          f.quantity
            ? f.material
              ? quantityText(f.quantity, f.material.unit, currency)
              : `Quantity ${f.quantity}`
            : null,
          can.seeAmounts
            ? f.amount
              ? `${money(f.amount, currency)} to deduct`
              : "Value to agree"
            : null,
          f.bill ? `on ${f.bill.number}` : null,
          f.loggedBy ? `logged by ${f.loggedBy}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {f.photoId && (
        <a
          href={productionHref.file(f.photoId)}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex w-fit items-center gap-1.5 text-[0.8125rem] ${linkClass}`}
        >
          <PaperclipIcon className="size-3.5" aria-hidden />
          Photo of the fault
        </a>
      )}
      {f.status !== "OPEN" && f.settledOn && (
        <p className="text-[0.8125rem] text-muted-foreground">
          {f.status === "DEDUCTED" ? "Deducted" : "Waived"} {formatDay(f.settledOn)}
          {f.settledBy ? ` by ${f.settledBy}` : ""}
          {f.settledNote ? `: ${f.settledNote}` : ""}
        </p>
      )}
      {can.settle && <SettleActions fault={f} />}
    </li>
  );
}

type Settling = "DEDUCTED" | "WAIVED" | "OPEN" | null;

/** Mark deducted, waive (with a reason) or put back to open. */
function SettleActions({ fault }: { fault: FaultItem }) {
  const router = useRouter();
  const [settling, setSettling] = useState<Settling>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {fault.status === "OPEN" ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => setSettling("DEDUCTED")}>
            <BadgeCheckIcon aria-hidden />
            Mark deducted
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSettling("WAIVED")}>
            <UndoDotIcon aria-hidden />
            Waive
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setSettling("OPEN")}>
          <RotateCcwIcon aria-hidden />
          Put back to open
        </Button>
      )}
      {settling && (
        <FormDialog
          title={
            settling === "DEDUCTED"
              ? `Mark ${fault.number} deducted?`
              : settling === "WAIVED"
                ? `Waive ${fault.number}?`
                : `Put ${fault.number} back to open?`
          }
          description={
            settling === "DEDUCTED"
              ? `It was taken off a payment to ${fault.supplier.name}. It stays in the log as deducted.`
              : settling === "WAIVED"
                ? `${fault.supplier.name} will not be charged for it. Say why; it stays in the log as waived.`
                : "It counts again as still to deduct."
          }
          submitLabel={
            settling === "DEDUCTED"
              ? "Mark deducted"
              : settling === "WAIVED"
                ? "Waive it"
                : "Put back to open"
          }
          pendingLabel="Saving"
          errorTitle="We could not change the fault"
          onClose={() => setSettling(null)}
          onSubmit={async (form) => {
            const note = String(form.get("note") ?? "").trim();
            if (settling === "WAIVED" && !note) {
              return {
                code: "VALIDATION",
                message: "Say why",
                fieldErrors: { note: ["Say why it is waived"] },
              };
            }
            const result = await settleFaultAction(fault.id, {
              status: settling,
              note: note || null,
            });
            if (!result.ok) return result.error;
            setSettling(null);
            router.refresh();
          }}
        >
          {(fieldError) =>
            settling === "OPEN" ? null : (
              <Field
                id="settle-note"
                label={settling === "WAIVED" ? "Why is it waived?" : "Which payment (optional)"}
                error={fieldError("note")}
              >
                <Textarea
                  id="settle-note"
                  name="note"
                  rows={2}
                  maxLength={500}
                  aria-invalid={Boolean(fieldError("note"))}
                />
              </Field>
            )
          }
        </FormDialog>
      )}
    </div>
  );
}

/** The faults as a list, newest first. */
export function FaultRows({
  items,
  can,
  currency,
  empty,
}: {
  items: FaultItem[];
  can: Can;
  currency: string;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="mt-4 grid divide-y" aria-label="Faults">
      {items.map((f) => (
        <FaultCard key={f.id} fault={f} can={can} currency={currency} />
      ))}
    </ul>
  );
}

/** "Log a fault": a Fabric Fault Note, a quality fault or missing pieces, by hand. */
export function LogFaultButton({
  today,
  batch,
  currency,
}: {
  today: string;
  batch?: { id: string; code: string };
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ShieldAlertIcon aria-hidden />
        Log a fault
      </Button>
      {open && (
        <FormDialog
          title={batch ? `Log a fault on ${batch.code}` : "Log a supplier fault"}
          description="Faulty fabric, a quality fault or missing pieces, with the value to take off the supplier's next payment."
          submitLabel="Log the fault"
          pendingLabel="Logging"
          errorTitle="We could not log the fault"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const text = (name: string) => String(form.get(name) ?? "").trim();
            const num = (name: string) =>
              text(name) ? Number(text(name).replace(/,/g, "")) : null;
            if (!supplier) {
              return {
                code: "VALIDATION",
                message: "Choose the supplier",
                fieldErrors: { supplierId: ["Choose who it is against"] },
              };
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
            const result = await createFaultAction({
              supplierId: supplier.id,
              photoId,
              kind: text("kind"),
              batchId: batch?.id ?? null,
              quantity: num("quantity"),
              amount: num("amount"),
              occurredOn: text("occurredOn") || undefined,
              note: text("note"),
            });
            if (!result.ok) return result.error;
            setOpen(false);
            setSupplier(null);
            router.refresh();
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id="fault-supplier"
                label="Supplier or factory"
                error={fieldError("supplierId")}
              >
                <SupplierPicker
                  id="fault-supplier"
                  value={supplier}
                  onChange={setSupplier}
                  invalid={Boolean(fieldError("supplierId"))}
                />
              </Field>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <Field id="fault-kind" label="What went wrong">
                  <NativeSelect id="fault-kind" name="kind" defaultValue="FABRIC_FAULT">
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {FAULT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="fault-day" label="On" error={fieldError("occurredOn")}>
                  <Input
                    id="fault-day"
                    name="occurredOn"
                    type="date"
                    max={today}
                    defaultValue={today}
                  />
                </Field>
                <Field
                  id="fault-quantity"
                  label="How much (optional)"
                  error={fieldError("quantity")}
                >
                  <Input
                    id="fault-quantity"
                    name="quantity"
                    inputMode="decimal"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  id="fault-amount"
                  label={`Value to deduct (${currency}, optional)`}
                  error={fieldError("amount")}
                >
                  <Input id="fault-amount" name="amount" inputMode="decimal" autoComplete="off" />
                </Field>
              </div>
              <Field id="fault-note" label="What was wrong" error={fieldError("note")}>
                <Textarea
                  id="fault-note"
                  name="note"
                  rows={3}
                  maxLength={1000}
                  placeholder="Holes in 2 rolls of navy pique, 14 kg set aside"
                  aria-invalid={Boolean(fieldError("note"))}
                />
              </Field>
              <Field
                id="fault-photo"
                label="Photo (optional)"
                hint="Kept with the fault. JPG, PNG, WebP or PDF, up to 10 MB."
                error={fieldError("photo")}
              >
                <Input
                  id="fault-photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="h-auto py-1.5 file:mr-3"
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}

/** A supplier's report card PDF, for any supplier (values on it: buyers, Production, Accounts). */
export function ReportCardPicker() {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  return (
    <div className="grid gap-3">
      <Field id="card-supplier" label="Supplier">
        <SupplierPicker id="card-supplier" value={supplier} onChange={setSupplier} />
      </Field>
      {supplier && (
        <Button asChild size="sm" className="justify-self-start">
          <a href={productionHref.reportCard(supplier.id)} target="_blank" rel="noopener">
            <FileDownIcon aria-hidden />
            Report card (PDF)
          </a>
        </Button>
      )}
    </div>
  );
}

/** The batch's faults: what is still open against its suppliers, the latest few, and the log. */
export function BatchFaultsPanel({
  data,
  batch,
  today,
  currency,
}: {
  data: FaultListData;
  batch: { id: string; code: string };
  today: string;
  currency: string;
}) {
  const open = data.openBySupplier.reduce((t, s) => t + s.count, 0);
  const openAmount = data.openBySupplier.reduce((t, s) => t + Number(s.amount ?? 0), 0);
  return (
    <Panel
      title="Fault log"
      id="batch-faults-heading"
      action={
        data.can.log ? (
          <LogFaultButton today={today} batch={batch} currency={currency} />
        ) : undefined
      }
    >
      {open > 0 ? (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {open} open {open === 1 ? "fault" : "faults"} against{" "}
            {data.openBySupplier.map((s) => s.supplier.name).join(", ")}
            {data.can.seeAmounts ? `, ${money(openAmount.toFixed(2), currency)} to deduct` : ""}.
          </span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Shorts at receive, fabric faults and missing pieces of this batch, to deduct from the
          supplier.
        </p>
      )}
      <FaultRows
        items={data.items}
        can={data.can}
        currency={currency}
        empty="Nothing in the fault log for this batch."
      />
      {data.items.length > 0 && (
        <p className="mt-4 text-sm">
          <Link href={productionHref.faults({ batchId: batch.id })} className={linkClass}>
            All of {batch.code}&apos;s faults
          </Link>
        </p>
      )}
    </Panel>
  );
}
