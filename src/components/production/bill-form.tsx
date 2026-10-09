"use client";

import type { PaymentMethod, PaymentType } from "@prisma/client";
import { LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { BillForm as BillFormData } from "@/modules/production/screens.service";
import { createBillAction, uploadProductionFileAction } from "@/server/actions/production.actions";

import { HeadOptions, PayMethodSelect } from "./cost-dialogs";
import { PAYMENT_TYPE_HINTS, PAYMENT_TYPE_LABELS, productionHref } from "./labels";
import { PartyPicker, ProjectPicker } from "./pickers";

type Party = { id: string; code: string; name: string };
type Project = { id: string; code: string; name: string };

/** One share of the bill: a project, what it is for and how much. */
type Share = {
  key: string;
  project: Project | null;
  headId: string;
  amount: string;
  description: string;
};

// Shares added in the browser get keys from this counter; the first one is
// keyed by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `share-${++nextKey}`;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const fixed2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * A supplier bill (Split Bill): who sent it, how it is paid (owed to the
 * supplier, or for Accounts paid now) and how its amount is shared across
 * projects and cost heads. Production Managers and Accounts enter bills.
 */
export function BillForm({ form: data, currency }: { form: BillFormData; currency: string }) {
  const router = useRouter();
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>("DUE");
  const [shares, setShares] = useState<Share[]>([
    { key: "share-start", project: data.project, headId: "", amount: "", description: "" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const general = error && error.code !== "INTERNAL" ? error.message : undefined;

  const total = shares.reduce((sum, s) => {
    const amount = readAmount(s.amount);
    return sum + (typeof amount === "number" ? amount : 0);
  }, 0);

  function change(key: string, next: Partial<Share>) {
    setShares((all) => all.map((s) => (s.key === key ? { ...s, ...next } : s)));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    if (!supplier) found.supplierId = "Choose the supplier who sent the bill.";
    const allocations = shares.map((s) => {
      const amount = readAmount(s.amount);
      if (!s.project) found[`${s.key}.project`] = "Choose the project.";
      if (!s.headId) found[`${s.key}.head`] = "Choose what it is for.";
      if (amount === "invalid") found[`${s.key}.amount`] = AMOUNT_HINT;
      else if (amount === null || amount <= 0) found[`${s.key}.amount`] = "Enter the amount.";
      return {
        projectId: s.project?.id ?? "",
        expenseHeadId: s.headId,
        amount: typeof amount === "number" ? amount : 0,
        description: s.description.trim() || undefined,
      };
    });
    if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
    setProblems(found);
    setError(undefined);
    if (Object.keys(found).length > 0) return;

    const type: PaymentType = data.canPayNow ? paymentType : "DUE";
    const day = textOf(form, "billDate");
    startTransition(async () => {
      let attachmentId: string | undefined;
      if (file) {
        const upload = new FormData();
        upload.set("file", file);
        const stored = await uploadProductionFileAction(upload);
        if (!stored.ok) {
          setProblems({ file: stored.error.message });
          return;
        }
        attachmentId = stored.data.id;
      }
      const result = await createBillAction({
        supplierId: supplier!.id,
        supplierRef: textOf(form, "supplierRef") || undefined,
        billDate: day && day !== data.today ? day : undefined,
        paymentType: type,
        ...(type === "CASH_BANK"
          ? {
              method: (textOf(form, "method") || "CASH") as PaymentMethod,
              reference: textOf(form, "reference") || undefined,
            }
          : {}),
        allocations,
        notes: textOf(form, "notes") || undefined,
        attachmentId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${productionHref.bill(result.data.id)}?created=1`);
    });
  }

  if (data.heads.length === 0) {
    return (
      <FormAlert tone="note">
        A bill is shared under cost heads such as Sewing charge or Fabric, and none are set up yet.{" "}
        <Link href="/production/cost-heads" className="font-medium underline underline-offset-4">
          Add them on the Cost heads tab
        </Link>{" "}
        (Production Managers).
      </FormAlert>
    );
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <Field id="supplierId" label="Supplier" error={fieldError("supplierId")}>
        <PartyPicker
          id="supplierId"
          kind="SUPPLIER"
          value={supplier}
          onChange={setSupplier}
          invalid={Boolean(fieldError("supplierId"))}
          describedBy={fieldError("supplierId") ? "supplierId-error" : undefined}
          autoFocus
        />
      </Field>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="supplierRef"
          label="Their bill number (optional)"
          error={fieldError("supplierRef")}
        >
          <Input id="supplierRef" name="supplierRef" maxLength={60} autoComplete="off" />
        </Field>
        <Field id="billDate" label="Bill date" error={fieldError("billDate")}>
          <Input
            id="billDate"
            name="billDate"
            type="date"
            defaultValue={data.today}
            max={data.today}
          />
        </Field>
      </div>

      {data.canPayNow ? (
        <ChoiceList<PaymentType>
          name="paymentType"
          legend="How it is paid"
          defaultValue="DUE"
          onChange={setPaymentType}
          options={(["DUE", "CASH_BANK"] as const).map((t) => ({
            value: t,
            label: PAYMENT_TYPE_LABELS[t],
            hint: PAYMENT_TYPE_HINTS[t],
          }))}
        />
      ) : (
        <FormAlert tone="note">
          It is owed to the supplier and goes on their account. Accounts pays it.
        </FormAlert>
      )}
      {data.canPayNow && paymentType === "CASH_BANK" && (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field id="method" label="Paid by" error={fieldError("method")}>
            <PayMethodSelect id="method" methods={data.methods} />
          </Field>
          <Field
            id="reference"
            label="Reference (optional)"
            hint="Cheque number, bKash transaction ID…"
          >
            <Input
              id="reference"
              name="reference"
              maxLength={120}
              autoComplete="off"
              aria-describedby="reference-hint"
            />
          </Field>
        </div>
      )}

      <fieldset className="grid min-w-0 gap-4">
        <legend className="mb-1 font-serif text-lg text-primary">What it is for</legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          One line per project. A bill for several projects is split here, and each project carries
          its share.
        </p>
        <ul className="grid grid-cols-1 gap-4">
          {shares.map((share, index) => (
            <li key={share.key} className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Line {index + 1}</p>
                {shares.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShares((all) => all.filter((s) => s.key !== share.key))}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2Icon aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
              <Field
                id={`${share.key}-project`}
                label="Project"
                error={fieldError(`${share.key}.project`)}
              >
                <ProjectPicker
                  id={`${share.key}-project`}
                  purpose="COST"
                  value={share.project}
                  onChange={(project) => change(share.key, { project })}
                  invalid={Boolean(fieldError(`${share.key}.project`))}
                  describedBy={
                    fieldError(`${share.key}.project`) ? `${share.key}-project-error` : undefined
                  }
                />
              </Field>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <Field
                  id={`${share.key}-head`}
                  label="What for"
                  error={fieldError(`${share.key}.head`)}
                >
                  <NativeSelect
                    id={`${share.key}-head`}
                    value={share.headId}
                    onChange={(e) => change(share.key, { headId: e.target.value })}
                    containerClassName="sm:w-full"
                    aria-invalid={Boolean(fieldError(`${share.key}.head`))}
                    aria-describedby={
                      fieldError(`${share.key}.head`) ? `${share.key}-head-error` : undefined
                    }
                  >
                    <option value="" disabled>
                      Choose a cost head
                    </option>
                    <HeadOptions heads={data.heads} />
                  </NativeSelect>
                </Field>
                <Field
                  id={`${share.key}-amount`}
                  label={`Amount (${currency})`}
                  error={fieldError(`${share.key}.amount`)}
                >
                  <Input
                    id={`${share.key}-amount`}
                    inputMode="decimal"
                    value={share.amount}
                    onChange={(e) => change(share.key, { amount: e.target.value })}
                    placeholder="0.00"
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError(`${share.key}.amount`))}
                    aria-describedby={
                      fieldError(`${share.key}.amount`) ? `${share.key}-amount-error` : undefined
                    }
                  />
                </Field>
              </div>
              <Field id={`${share.key}-description`} label="Details (optional)">
                <Input
                  id={`${share.key}-description`}
                  value={share.description}
                  onChange={(e) => change(share.key, { description: e.target.value })}
                  maxLength={500}
                  autoComplete="off"
                  placeholder="Like: 1,200 pcs at 45 a piece"
                />
              </Field>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() =>
              setShares((all) => [
                ...all,
                { key: newKey(), project: null, headId: "", amount: "", description: "" },
              ])
            }
          >
            <PlusIcon aria-hidden />
            Split across another project
          </Button>
          <p className="text-sm tabular-nums">
            <span className="text-muted-foreground">Bill total </span>
            <span className="font-serif text-lg">{money(fixed2(total), currency)}</span>
          </p>
        </div>
      </fieldset>

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="file"
          label="Photo or PDF of the bill (optional)"
          hint="Kept with the bill. Up to 10 MB."
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
        <Field id="notes" label="Notes (optional)">
          <Textarea id="notes" name="notes" rows={2} maxLength={2000} />
        </Field>
      </div>

      {general && <FormAlert>{general}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={data.project ? productionHref.project(data.project.id) : "/production/bills"}>
            Cancel
          </Link>
        </Button>
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : "Save the bill"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the bill"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
