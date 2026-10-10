"use client";

import type { ComplianceType } from "@prisma/client";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addDays } from "@/lib/dates";
import type { ComplianceView } from "@/modules/compliance/compliance.service";
import {
  createComplianceAction,
  renewComplianceAction,
  updateComplianceAction,
} from "@/server/actions/compliance.actions";

import { COMPLIANCE_TYPE_LABELS, COMPLIANCE_TYPES, complianceHref } from "./labels";

/** "30" from the form, or a field problem. */
function alertDays(form: FormData): number | { problem: string } {
  const raw = textOf(form, "alertDaysBefore") || "30";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    return { problem: "A whole number of days from 0 to 365." };
  }
  return days;
}

function AlertField({ value, error }: { value?: number; error?: string }) {
  return (
    <Field
      id="compliance-alert"
      label="Start reminding (days before expiry)"
      hint="The people who see licences hear about it in the app from then on."
      error={error}
    >
      <Input
        id="compliance-alert"
        name="alertDaysBefore"
        inputMode="numeric"
        defaultValue={value ?? 30}
        aria-describedby="compliance-alert-hint"
        aria-invalid={Boolean(error)}
      />
    </Field>
  );
}

/**
 * Adds a licence or registration (compliance.manage), or corrects one: what it
 * is, its number, who issued it, when it was issued and expires, when to start
 * reminding, and notes. The scan is added on its page.
 */
export function ComplianceDialog({
  record,
  type: initialType,
  onDone,
  onClose,
}: {
  record?: ComplianceView;
  /** A new record's kind ("Add the trade licence"). */
  type?: ComplianceType;
  onDone: (message: string, id: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<ComplianceType>(record?.type ?? initialType ?? "TRADE_LICENSE");
  const editing = Boolean(record);

  return (
    <FormDialog
      title={editing ? "Correct the record" : "Add a licence or registration"}
      description={
        editing
          ? "Fix a mistake in this term. When the licence is renewed, use Renew instead so this term stays as history."
          : "Add the scan on its page once it is saved."
      }
      submitLabel={editing ? "Save" : "Add"}
      pendingLabel="Saving"
      errorTitle="We could not save the record"
      onClose={onClose}
      onSubmit={async (form) => {
        const days = alertDays(form);
        if (typeof days !== "number") return problem({ alertDaysBefore: days.problem });
        const title = textOf(form, "title");
        if (title && title.length < 2) return problem({ title: "At least 2 letters." });
        const issueDate = textOf(form, "issueDate");
        const expiryDate = textOf(form, "expiryDate");
        if (issueDate && expiryDate && expiryDate < issueDate) {
          return problem({ expiryDate: "The expiry date is before the issue date." });
        }
        const input = {
          type,
          ...(title ? { title } : editing ? { title: COMPLIANCE_TYPE_LABELS[type] } : {}),
          number: textOf(form, "number") || null,
          issuingAuthority: textOf(form, "issuingAuthority") || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          alertDaysBefore: days,
          notes: textOf(form, "notes") || null,
        };
        const result = record
          ? await updateComplianceAction(record.id, input)
          : await createComplianceAction(input);
        if (!result.ok) return result.error;
        onDone(editing ? "The record is saved." : `${result.data.title} is added.`, result.data.id);
      }}
    >
      {(fieldError) => (
        <>
          <Field id="compliance-type" label="What it is" error={fieldError("type")}>
            <NativeSelect
              id="compliance-type"
              value={type}
              onChange={(e) => setType(e.target.value as ComplianceType)}
              containerClassName="sm:w-full"
            >
              {COMPLIANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPLIANCE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="compliance-title"
            label="Name (optional)"
            hint="To tell two apart, such as the trade licence of each factory."
            error={fieldError("title")}
          >
            <Input
              id="compliance-title"
              name="title"
              maxLength={200}
              defaultValue={
                record && record.title !== COMPLIANCE_TYPE_LABELS[record.type] ? record.title : ""
              }
              placeholder={COMPLIANCE_TYPE_LABELS[type]}
              autoComplete="off"
              aria-describedby="compliance-title-hint"
            />
          </Field>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="compliance-number" label="Number (optional)" error={fieldError("number")}>
              <Input
                id="compliance-number"
                name="number"
                maxLength={100}
                defaultValue={record?.number ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field
              id="compliance-authority"
              label="Issued by (optional)"
              error={fieldError("issuingAuthority")}
            >
              <Input
                id="compliance-authority"
                name="issuingAuthority"
                maxLength={200}
                defaultValue={record?.issuingAuthority ?? ""}
                placeholder="Dhaka North City Corporation"
              />
            </Field>
            <Field
              id="compliance-issued"
              label="Issued on (optional)"
              error={fieldError("issueDate")}
            >
              <Input
                id="compliance-issued"
                name="issueDate"
                type="date"
                defaultValue={record?.issueDate ?? ""}
              />
            </Field>
            <Field
              id="compliance-expiry"
              label="Expires on"
              hint="Leave empty if it never expires (a TIN, for one)."
              error={fieldError("expiryDate")}
            >
              <Input
                id="compliance-expiry"
                name="expiryDate"
                type="date"
                defaultValue={record?.expiryDate ?? ""}
                aria-describedby="compliance-expiry-hint"
                aria-invalid={Boolean(fieldError("expiryDate"))}
              />
            </Field>
          </div>
          <AlertField value={record?.alertDaysBefore} error={fieldError("alertDaysBefore")} />
          <Field id="compliance-notes" label="Notes (optional)" error={fieldError("notes")}>
            <Textarea
              id="compliance-notes"
              name="notes"
              rows={2}
              maxLength={2000}
              defaultValue={record?.notes ?? ""}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/**
 * Records the renewed term of a licence (compliance.manage): the new expiry
 * date, and the number, issuer and issue date when they changed. The term
 * before stays as history, and its reminders stop.
 */
export function RenewDialog({
  record,
  today,
  onDone,
  onClose,
}: {
  record: ComplianceView;
  today: string;
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={`Renew: ${record.title}`}
      description="The term before stays as history and its reminders stop. Add the new scan on the new record."
      submitLabel="Save the renewal"
      pendingLabel="Saving"
      errorTitle="We could not save the renewal"
      onClose={onClose}
      onSubmit={async (form) => {
        const expiryDate = textOf(form, "expiryDate");
        if (!expiryDate) return problem({ expiryDate: "Pick the new expiry date." });
        const issueDate = textOf(form, "issueDate");
        if (issueDate && expiryDate < issueDate) {
          return problem({ expiryDate: "The expiry date is before the issue date." });
        }
        const days = alertDays(form);
        if (typeof days !== "number") return problem({ alertDaysBefore: days.problem });
        const result = await renewComplianceAction(record.id, {
          expiryDate,
          issueDate: issueDate || null,
          number: textOf(form, "number") || null,
          issuingAuthority: textOf(form, "issuingAuthority") || null,
          alertDaysBefore: days,
          notes: textOf(form, "notes") || null,
        });
        if (!result.ok) return result.error;
        onDone(result.data.id);
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="renew-issued" label="Renewed on" error={fieldError("issueDate")}>
              <Input id="renew-issued" name="issueDate" type="date" defaultValue={today} />
            </Field>
            <Field id="renew-expiry" label="New expiry date" error={fieldError("expiryDate")}>
              <Input
                id="renew-expiry"
                name="expiryDate"
                type="date"
                min={record.expiryDate ? addDays(record.expiryDate, 1) : undefined}
                aria-invalid={Boolean(fieldError("expiryDate"))}
              />
            </Field>
            <Field id="renew-number" label="Number" error={fieldError("number")}>
              <Input
                id="renew-number"
                name="number"
                maxLength={100}
                defaultValue={record.number ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field id="renew-authority" label="Issued by" error={fieldError("issuingAuthority")}>
              <Input
                id="renew-authority"
                name="issuingAuthority"
                maxLength={200}
                defaultValue={record.issuingAuthority ?? ""}
              />
            </Field>
          </div>
          <Field
            id="compliance-alert"
            label="Start reminding (days before expiry)"
            error={fieldError("alertDaysBefore")}
          >
            <Input
              id="compliance-alert"
              name="alertDaysBefore"
              inputMode="numeric"
              defaultValue={record.alertDaysBefore}
              aria-invalid={Boolean(fieldError("alertDaysBefore"))}
            />
          </Field>
          <Field id="renew-notes" label="Notes (optional)" error={fieldError("notes")}>
            <Textarea
              id="renew-notes"
              name="notes"
              rows={2}
              maxLength={2000}
              defaultValue={record.notes ?? ""}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** "Add a licence", opening the form; the new record's page opens once it is added. */
export function AddComplianceButton({
  type,
  label = "Add a licence",
  variant = "default",
  className,
}: {
  type?: ComplianceType;
  label?: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden />
        {label}
      </Button>
      {open && (
        <ComplianceDialog
          type={type}
          onClose={() => setOpen(false)}
          onDone={(_message, id) => {
            setOpen(false);
            router.push(`${complianceHref.record(id)}?added=1`);
          }}
        />
      )}
    </>
  );
}
