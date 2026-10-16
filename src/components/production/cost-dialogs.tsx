"use client";

import type { PaymentMethod, PaymentType } from "@prisma/client";
import { LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { reach } from "@/lib/reach";
import type { ActionError } from "@/lib/result";
import type { BillForm, PartyOption } from "@/modules/production/screens.service";
import {
  addProjectCostAction,
  getBillFormAction,
  voidProjectCostAction,
} from "@/server/actions/production.actions";

import { COST_HEAD_CATEGORY_LABELS, PAYMENT_TYPE_HINTS, PAYMENT_TYPE_LABELS } from "./labels";
import { PartyPicker } from "./pickers";

/** An amount above zero, or a problem for the `name` field. */
export function readPositive(form: FormData, name: string): number | ActionError {
  const amount = readAmount(textOf(form, name));
  if (amount === "invalid") return problem({ [name]: AMOUNT_HINT });
  if (amount === null || amount <= 0) return problem({ [name]: "Enter the amount." });
  return amount;
}

/** A day typed into a date box, left out when it is today (the server stamps the time). */
export const dayOrNow = (form: FormData, name: string, today: string) => {
  const day = textOf(form, name);
  return day && day !== today ? day : undefined;
};

/** The bill or cost a new one looks like, when the server found one entered already. */
export function duplicateOf(error: ActionError): string | null {
  return error.fieldErrors?.allowDuplicate ? error.message : null;
}

/**
 * "Entered already?": what the new bill or cost matched (the supplier's same
 * bill number, or the same amount close by) and a tick to enter it anyway.
 */
export function DuplicateCheck({
  id,
  match,
  checked,
  onChange,
}: {
  id: string;
  match: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid gap-2">
      <FormAlert tone="note">{match}</FormAlert>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-3 rounded-md border bg-card px-3 py-2.5 has-[:checked]:border-primary/50 has-[:checked]:bg-secondary"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">It is a different one: enter it anyway</span>
          <span className="text-[0.8125rem] leading-snug text-muted-foreground">
            Leave it unticked and cancel if it is the same, so it is not booked twice.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Asks the person to look at the match first (a quiet error: the match shows above the tick). */
export const duplicateProblem = (match: string): ActionError => ({
  code: "VALIDATION",
  message: match,
  fieldErrors: {},
});

/** The cost heads to file a cost under, making cost first, then materials. */
export function HeadOptions({ heads }: { heads: BillForm["heads"] }) {
  const groups = (["PRODUCTION", "RAW_MATERIAL"] as const)
    .map((category) => ({
      category,
      heads: heads.filter((h) => h.category === category),
    }))
    .filter((g) => g.heads.length > 0);
  const others = heads.filter((h) => h.category !== "PRODUCTION" && h.category !== "RAW_MATERIAL");
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.category} label={COST_HEAD_CATEGORY_LABELS[g.category]}>
          {g.heads.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </optgroup>
      ))}
      {others.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </>
  );
}

/**
 * Adds one cost to a project: owed to a supplier (Due, which goes on their
 * account for Accounts to pay) or, for Accounts, paid now from cash or bank.
 * The cost heads and payment choices load when the window opens.
 */
export function AddCostDialog({
  project,
  canPayNow,
  canManageHeads,
  currency,
  onDone,
  onClose,
}: {
  project: { id: string; code: string };
  canPayNow: boolean;
  /** Whether to point to the Cost heads tab when there are none. */
  canManageHeads: boolean;
  currency: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<BillForm>();
  const [loadError, setLoadError] = useState<string>();
  const [paymentType, setPaymentType] = useState<PaymentType>("DUE");
  const [supplier, setSupplier] = useState<PartyOption | null>(null);
  const [duplicate, setDuplicate] = useState<string>();
  const [anyway, setAnyway] = useState(false);

  useEffect(() => {
    let live = true;
    void reach(() => getBillFormAction({ projectId: project.id })).then((result) => {
      if (!live) return;
      if (result.ok) setForm(result.data);
      else setLoadError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [project.id]);

  const payNow = canPayNow && Boolean(form?.canPayNow);
  const today = form?.today ?? "";

  return (
    <FormDialog
      title={`Add a cost to ${project.code}`}
      description="Making charges, trims, transport or anything else this project costs. It counts towards the cost of its pieces."
      submitLabel="Add the cost"
      pendingLabel="Adding"
      errorTitle="We could not add the cost"
      onClose={onClose}
      onSubmit={async (data) => {
        if (!form) return problem({ expenseHeadId: loadError ?? "Wait for the form to load." });
        const head = textOf(data, "expenseHeadId");
        if (!head) return problem({ expenseHeadId: "Choose what the cost is for." });
        const amount = readPositive(data, "amount");
        if (typeof amount !== "number") return amount;
        const type: PaymentType = payNow ? paymentType : "DUE";
        if (type === "DUE" && !supplier) {
          return problem({ supplierId: "Choose the supplier this is owed to." });
        }
        const result = await addProjectCostAction(project.id, {
          expenseHeadId: head,
          amount,
          paymentType: type,
          supplierId: supplier?.id,
          supplierRef: (supplier && textOf(data, "supplierRef")) || undefined,
          date: dayOrNow(data, "date", today),
          description: textOf(data, "description") || undefined,
          ...(type === "CASH_BANK"
            ? {
                accountId: textOf(data, "accountId") || undefined,
                method: (textOf(data, "method") || "CASH") as PaymentMethod,
                reference: textOf(data, "reference") || undefined,
              }
            : {}),
          allowDuplicate: duplicate && anyway ? true : undefined,
        });
        if (!result.ok) {
          const match = duplicateOf(result.error);
          if (!match) return result.error;
          setDuplicate(match);
          setAnyway(false);
          return duplicateProblem(match);
        }
        onDone(
          `${money(amount.toFixed(2), currency)} was added to ${project.code}${
            type === "DUE" && supplier ? `, owed to ${supplier.name}` : ""
          }.`,
        );
      }}
    >
      {(fieldError) =>
        loadError ? (
          <FormAlert>{loadError}</FormAlert>
        ) : !form ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading the cost heads
          </p>
        ) : form.heads.length === 0 ? (
          <FormAlert tone="note">
            Costs are filed under cost heads such as Sewing charge or Trims, and none are set up
            yet.{" "}
            {canManageHeads ? (
              <Link
                href="/production/cost-heads"
                className="font-medium underline underline-offset-4"
              >
                Add one on the Cost heads tab.
              </Link>
            ) : (
              "Ask a Production Manager to add them."
            )}
          </FormAlert>
        ) : (
          <>
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="cost-head" label="What for" error={fieldError("expenseHeadId")}>
                <NativeSelect
                  id="cost-head"
                  name="expenseHeadId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                  aria-invalid={Boolean(fieldError("expenseHeadId"))}
                  aria-describedby={fieldError("expenseHeadId") ? "cost-head-error" : undefined}
                >
                  <option value="" disabled>
                    Choose a cost head
                  </option>
                  <HeadOptions heads={form.heads} />
                </NativeSelect>
              </Field>
              <Field id="cost-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
                <Input
                  id="cost-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("amount"))}
                  aria-describedby={fieldError("amount") ? "cost-amount-error" : undefined}
                />
              </Field>
            </div>
            {payNow && (
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
            )}
            <Field
              id="cost-supplier"
              label={paymentType === "DUE" || !payNow ? "Owed to" : "Paid to (optional)"}
              hint={
                paymentType === "DUE" || !payNow
                  ? "The supplier's account shows what is owed."
                  : "Keeps it on the supplier's history."
              }
              error={fieldError("supplierId")}
            >
              <PartyPicker
                id="cost-supplier"
                kind="SUPPLIER"
                value={supplier}
                onChange={setSupplier}
                invalid={Boolean(fieldError("supplierId"))}
                describedBy={
                  fieldError("supplierId") ? "cost-supplier-error" : "cost-supplier-hint"
                }
              />
            </Field>
            <div className="grid items-start gap-5 sm:grid-cols-2">
              {supplier && (
                <Field id="cost-ref" label="Their bill number (optional)">
                  <Input id="cost-ref" name="supplierRef" maxLength={60} autoComplete="off" />
                </Field>
              )}
              <Field id="cost-date" label="Date" error={fieldError("date")}>
                <Input id="cost-date" name="date" type="date" defaultValue={today} max={today} />
              </Field>
              {payNow && paymentType === "CASH_BANK" && (
                <PaidFromFields
                  idPrefix="cost"
                  accounts={form.accounts}
                  currency={currency}
                  fieldError={fieldError}
                />
              )}
            </div>
            <Field id="cost-description" label="Details (optional)">
              <Textarea id="cost-description" name="description" rows={2} maxLength={500} />
            </Field>
            {duplicate && (
              <DuplicateCheck
                id="cost-anyway"
                match={duplicate}
                checked={anyway}
                onChange={setAnyway}
              />
            )}
          </>
        )
      }
    </FormDialog>
  );
}

/** Voids a cost paid from cash or bank by mistake (Accounts): the money goes back. */
export function VoidCostDialog({
  cost,
  currency,
  onDone,
  onClose,
}: {
  cost: { id: string; number: string; amount: string; label: string };
  currency: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={`Void ${cost.number}?`}
      description={`${cost.label}, ${money(cost.amount, currency)}. The payment is reversed and the project's cost goes down by it.`}
      submitLabel="Void the cost"
      pendingLabel="Voiding"
      destructive
      errorTitle="We could not void the cost"
      onClose={onClose}
      onSubmit={async (form) => {
        const reason = readReason(form, 5);
        if (typeof reason !== "string") return reason;
        const result = await voidProjectCostAction(cost.id, { reason });
        if (!result.ok) return result.error;
        onDone(`${cost.number} was voided.`);
      }}
    >
      {(fieldError) => <ReasonField id="void-cost-reason" min={5} error={fieldError("reason")} />}
    </FormDialog>
  );
}
