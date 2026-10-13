"use client";

import type { PaymentMethod, PaymentType } from "@prisma/client";
import { HandCoinsIcon, LoaderCircleIcon, PlusIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Panel } from "@/components/sales/detail-bits";
import { METHOD_LABELS, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { BatchMoney } from "@/modules/production/batch-money.service";
import type { BillForm, PartyOption } from "@/modules/production/screens.service";
import {
  addBatchCostAction,
  getBillFormAction,
  payForBatchAction,
} from "@/server/actions/production.actions";

import {
  dayOrNow,
  DuplicateCheck,
  duplicateOf,
  duplicateProblem,
  HeadOptions,
  readPositive,
} from "./cost-dialogs";
import { PAYMENT_TYPE_HINTS, PAYMENT_TYPE_LABELS, productionHref } from "./labels";
import { PartyPicker } from "./pickers";

/*
 * A master batch's money on its page: Cost Setup (a cost such as QC or travel
 * on one style or split equally among its styles), the advances paid to the
 * factory for it (Advance CM) and the way to its final CM settlement.
 */

type Style = { id: string; code: string; name: string };
type Split = "EQUAL" | "ONE";

/** The cost heads and money accounts the dialogs need, loaded when one opens. */
function useBillForm() {
  const [form, setForm] = useState<BillForm>();
  const [loadError, setLoadError] = useState<string>();
  useEffect(() => {
    let live = true;
    void getBillFormAction({}).then((result) => {
      if (!live) return;
      if (result.ok) setForm(result.data);
      else setLoadError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, []);
  return { form, loadError };
}

function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
      {children}
    </p>
  );
}

/**
 * Adds a batch cost (QC, travel...) by its Cost Setup: split equally among the
 * open styles or on one. Owed to a supplier (Due) or, for Accounts, paid now.
 */
function BatchCostDialog({
  batch,
  styles,
  canPayNow,
  currency,
  onDone,
  onClose,
}: {
  batch: { id: string; code: string };
  styles: Style[];
  canPayNow: boolean;
  currency: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { form, loadError } = useBillForm();
  const [split, setSplit] = useState<Split>(styles.length > 1 ? "EQUAL" : "ONE");
  const [paymentType, setPaymentType] = useState<PaymentType>("DUE");
  const [supplier, setSupplier] = useState<PartyOption | null>(null);
  const [duplicate, setDuplicate] = useState<string>();
  const [anyway, setAnyway] = useState(false);
  const payNow = canPayNow && Boolean(form?.canPayNow);
  const today = form?.today ?? "";

  return (
    <FormDialog
      title={`Add a cost to ${batch.code}`}
      description="QC visits, travel, couriers or anything else the batch costs. Choose how it is set up on the styles; each style carries its share in its own cost."
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
        const projectId = split === "ONE" ? textOf(data, "projectId") : "";
        if (split === "ONE" && !projectId) return problem({ projectId: "Choose the style." });
        const type: PaymentType = payNow ? paymentType : "DUE";
        if (type === "DUE" && !supplier) {
          return problem({ supplierId: "Choose the supplier this is owed to." });
        }
        const result = await addBatchCostAction(batch.id, {
          expenseHeadId: head,
          amount,
          paymentType: type,
          split,
          projectId: projectId || undefined,
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
        const { shares } = result.data;
        onDone(
          shares.length > 1
            ? `${money(result.data.total, currency)} was split equally among ${shares.length} styles: ${shares
                .map((s) => `${s.code} ${money(s.amount, currency)}`)
                .join(", ")}.`
            : `${money(result.data.total, currency)} was added to ${shares[0]!.code}.`,
        );
      }}
    >
      {(fieldError) =>
        loadError ? (
          <FormAlert>{loadError}</FormAlert>
        ) : !form ? (
          <Loading>Loading the cost heads</Loading>
        ) : (
          <>
            <ChoiceList<Split>
              name="split"
              legend="Cost Setup"
              defaultValue={split}
              onChange={setSplit}
              options={[
                {
                  value: "EQUAL",
                  label: `Split equally among all ${styles.length} open styles`,
                  hint: "To the cent; any odd cents go to the first styles.",
                },
                { value: "ONE", label: "On one style", hint: "All of it on the style chosen." },
              ]}
            />
            {split === "ONE" && (
              <Field id="batch-cost-style" label="Style" error={fieldError("projectId")}>
                <NativeSelect
                  id="batch-cost-style"
                  name="projectId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                  aria-invalid={Boolean(fieldError("projectId"))}
                >
                  <option value="" disabled>
                    Choose a style
                  </option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field id="batch-cost-head" label="What for" error={fieldError("expenseHeadId")}>
                <NativeSelect
                  id="batch-cost-head"
                  name="expenseHeadId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                  aria-invalid={Boolean(fieldError("expenseHeadId"))}
                >
                  <option value="" disabled>
                    Choose a cost head
                  </option>
                  <HeadOptions heads={form.heads} />
                </NativeSelect>
              </Field>
              <Field
                id="batch-cost-amount"
                label={`Amount (${currency})`}
                error={fieldError("amount")}
              >
                <Input
                  id="batch-cost-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("amount"))}
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
              id="batch-cost-supplier"
              label={paymentType === "DUE" || !payNow ? "Owed to" : "Paid to (optional)"}
              hint={
                paymentType === "DUE" || !payNow
                  ? "One bill on their account, split across the styles."
                  : "Keeps it on the supplier's history."
              }
              error={fieldError("supplierId")}
            >
              <PartyPicker
                id="batch-cost-supplier"
                kind="SUPPLIER"
                value={supplier}
                onChange={setSupplier}
                invalid={Boolean(fieldError("supplierId"))}
              />
            </Field>
            <div className="grid items-start gap-5 sm:grid-cols-2">
              {supplier && (
                <Field id="batch-cost-ref" label="Their bill number (optional)">
                  <Input id="batch-cost-ref" name="supplierRef" maxLength={60} autoComplete="off" />
                </Field>
              )}
              <Field id="batch-cost-date" label="Date" error={fieldError("date")}>
                <Input
                  id="batch-cost-date"
                  name="date"
                  type="date"
                  defaultValue={today}
                  max={today}
                />
              </Field>
              {payNow && paymentType === "CASH_BANK" && (
                <PaidFromFields
                  idPrefix="batch-cost"
                  accounts={form.accounts}
                  currency={currency}
                  fieldError={fieldError}
                />
              )}
            </div>
            <Field id="batch-cost-description" label="Details (optional)">
              <Textarea
                id="batch-cost-description"
                name="description"
                rows={2}
                maxLength={500}
                placeholder="QC visit to the factory, 12 October"
              />
            </Field>
            {duplicate && (
              <DuplicateCheck
                id="batch-cost-anyway"
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

/** Accounts pays the factory (or a supplier) for the batch: an advance on the CM. */
function PayAdvanceDialog({
  money: data,
  currency,
  onDone,
  onClose,
}: {
  money: BatchMoney;
  currency: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const { form, loadError } = useBillForm();
  const [supplier, setSupplier] = useState<PartyOption | null>(
    data.factory
      ? {
          id: data.factory.id,
          code: data.factory.code,
          name: data.factory.name,
          phone: null,
          city: null,
        }
      : null,
  );
  const today = form?.today ?? "";
  return (
    <FormDialog
      title={`Pay for ${data.batch.code}`}
      description="An advance on the CM, kept under the master batch. It settles the bills of the batch's styles first; what is left stays on their account as an advance."
      submitLabel="Record the payment"
      pendingLabel="Recording"
      errorTitle="We could not record the payment"
      onClose={onClose}
      onSubmit={async (values) => {
        if (!form) return problem({ amount: loadError ?? "Wait for the form to load." });
        if (!supplier) return problem({ supplierId: "Choose who is paid." });
        const amount = readPositive(values, "amount");
        if (typeof amount !== "number") return amount;
        const result = await payForBatchAction(data.batch.id, {
          supplierId: supplier.id,
          amount,
          paymentDate: dayOrNow(values, "paymentDate", today),
          method: (textOf(values, "method") || "CASH") as PaymentMethod,
          accountId: textOf(values, "accountId") || undefined,
          reference: textOf(values, "reference") || undefined,
          notes: textOf(values, "notes") || undefined,
        });
        if (!result.ok) return result.error;
        onDone(
          `${result.data.number}: ${money(result.data.amount, currency)} paid to ${
            result.data.supplier ?? supplier.name
          } for ${data.batch.code}.`,
        );
      }}
    >
      {(fieldError) =>
        loadError ? (
          <FormAlert>{loadError}</FormAlert>
        ) : !form ? (
          <Loading>Loading the cash and bank accounts</Loading>
        ) : (
          <>
            <Field
              id="advance-supplier"
              label="Paid to"
              hint="The batch's factory, or a fabric supplier paid for this batch."
              error={fieldError("supplierId") ?? fieldError("batchId")}
            >
              <PartyPicker
                id="advance-supplier"
                kind="SUPPLIER"
                value={supplier}
                onChange={setSupplier}
                invalid={Boolean(fieldError("supplierId") ?? fieldError("batchId"))}
              />
            </Field>
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field
                id="advance-amount"
                label={`Amount (${currency})`}
                error={fieldError("amount")}
              >
                <Input
                  id="advance-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldError("amount"))}
                />
              </Field>
              <Field id="advance-date" label="Date" error={fieldError("paymentDate")}>
                <Input
                  id="advance-date"
                  name="paymentDate"
                  type="date"
                  defaultValue={today}
                  max={today}
                />
              </Field>
              <PaidFromFields
                idPrefix="advance"
                accounts={form.accounts}
                currency={currency}
                fieldError={fieldError}
              />
            </div>
            <Field id="advance-notes" label="Notes (optional)">
              <Textarea
                id="advance-notes"
                name="notes"
                rows={2}
                maxLength={1000}
                placeholder={`Advance CM for ${data.batch.code}`}
              />
            </Field>
          </>
        )
      }
    </FormDialog>
  );
}

/** "Factory money" on the batch page (Production Managers and Accounts). */
export function BatchMoneyPanel({
  data,
  styles,
  canAddCost,
  canPayNow,
  currency,
}: {
  data: BatchMoney;
  /** The open styles a cost can go on. */
  styles: Style[];
  canAddCost: boolean;
  canPayNow: boolean;
  currency: string;
}) {
  const [open, setOpen] = useState<"cost" | "pay" | null>(null);
  const [notice, setNotice] = useState<string>();
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <Panel title="Factory money" id="batch-money-heading">
      {notice && (
        <div className="mt-3">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      <div className="mt-4 grid gap-5">
        <div className="grid gap-2">
          <p className="text-sm font-medium">Cost Setup</p>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            QC, travel and other batch costs: split equally among the styles, or on one style.
          </p>
          {canAddCost && styles.length > 0 && (
            <div>
              <Button size="sm" variant="outline" onClick={() => setOpen("cost")}>
                <PlusIcon aria-hidden />
                Add a cost (QC, travel…)
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Advance taken</span>
            <span className="font-medium tabular-nums">{money(data.advanceTotal, currency)}</span>
          </p>
          {data.advances.length > 0 ? (
            <ul className="grid gap-1.5" aria-label="Advances paid for the batch">
              {data.advances.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 text-[0.8125rem]"
                >
                  <span>
                    <span className="font-medium">{a.number}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDay(a.on)} · {a.supplier.name} · {METHOD_LABELS[a.method]}
                    </span>
                  </span>
                  <span className="tabular-nums">{money(a.amount, currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.8125rem] text-muted-foreground">
              No advance paid for this batch yet.
            </p>
          )}
          {data.can.pay && (
            <div>
              <Button size="sm" variant="outline" onClick={() => setOpen("pay")}>
                <HandCoinsIcon aria-hidden />
                Pay an advance
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2 border-t pt-4">
          <p className="text-sm font-medium">Final CM settlement</p>
          <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
            {data.settlement
              ? `Settled on ${data.settlement.number}: final payable ${money(data.settlement.payable, currency)}.`
              : "Total CM - Deductions - Advance taken = Final payable, with the PDF bill for the factory. The deductions come off the factory's Supplier Due when it is saved."}
          </p>
          <div>
            <Button asChild size="sm" variant={data.settlement ? "outline" : "default"}>
              <Link href={productionHref.cmSettlement(data.batch.id)}>
                <ReceiptTextIcon aria-hidden />
                {data.settlement ? "Open the CM settlement" : "Work out the CM settlement"}
              </Link>
            </Button>
          </div>
        </div>

        <p className="border-t pt-4 text-[0.75rem] leading-relaxed text-muted-foreground">
          Fabric and the factory are paid style by style or by batch (project-wise settlement).
          Accessories suppliers are paid on one continuous ledger, which takes every payment off
          their overall Supplier Due.
        </p>
      </div>

      {open === "cost" && (
        <BatchCostDialog
          batch={data.batch}
          styles={styles}
          canPayNow={canPayNow}
          currency={currency}
          onDone={done}
          onClose={close}
        />
      )}
      {open === "pay" && (
        <PayAdvanceDialog money={data} currency={currency} onDone={done} onClose={close} />
      )}
    </Panel>
  );
}
