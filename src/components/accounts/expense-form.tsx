"use client";

import { PaperclipIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PartyOption } from "@/modules/accounts/screens.service";
import type { ExpenseForm as ExpenseFormData } from "@/modules/expenses/screens.service";
import {
  createExpenseAction,
  updateExpenseAction,
  uploadExpenseReceiptAction,
} from "@/server/actions/expenses.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { accountsHref } from "./labels";
import { AccountsPartyPicker, PaidFromFields } from "./money-fields";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type How = "CASH_BANK" | "DUE";

/**
 * An expense (Quick Add) or a change to one: the head, the amount and day, how
 * it was paid, who and what it was for, and a receipt photo. Accounts' expenses
 * go into the books straight away; anyone else's become claims Accounts pays
 * back. Conveyance and food name the employee and the purpose.
 */
export function ExpenseForm({ form: data, currency }: { form: ExpenseFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const expense = data.expense;
  const moneyLocked = expense?.status === "POSTED";
  const [headId, setHeadId] = useState(expense?.headId ?? "");
  const [how, setHow] = useState<How>("CASH_BANK");
  const [supplier, setSupplier] = useState<PartyOption | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const head = data.heads.find((h) => h.id === headId);
  const namesEmployee = Boolean(head?.requiresEmployee);
  const showEmployee = namesEmployee || Boolean(expense?.employeeId);
  const payNow = !expense && how === "CASH_BANK" && data.can.payNow;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    const text = (name: string) => textOf(values, name);
    if (!moneyLocked && !headId) found.headId = "Choose what it was for.";
    const amount = moneyLocked ? null : readPositive(values, "amount");
    if (amount !== null && typeof amount !== "number") {
      found.amount = amount.fieldErrors?.amount?.[0] ?? "Enter the amount.";
    }
    if (!expense && how === "DUE" && !supplier)
      found.supplierId = "Choose the supplier it is owed to.";
    if (namesEmployee && !text("employeeId")) found.employeeId = "Choose the employee.";
    if (namesEmployee && !text("purpose")) found.purpose = "Say what it was for.";
    if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0) return;

    form.startTransition(async () => {
      let receiptFileId: string | undefined;
      if (file) {
        const upload = new FormData();
        upload.set("file", file);
        const stored = await uploadExpenseReceiptAction(upload);
        if (!stored.ok) {
          form.setProblems({ file: stored.error.message });
          return;
        }
        receiptFileId = stored.data.id;
      }
      const details = {
        ...(showEmployee ? { employeeId: text("employeeId") || null } : {}),
        purpose: text("purpose") || null,
        fromLocation: namesEmployee ? text("fromLocation") || null : undefined,
        toLocation: namesEmployee ? text("toLocation") || null : undefined,
        description: text("description") || null,
        ...(receiptFileId ? { receiptFileId } : {}),
      };
      if (expense) {
        const day = text("date");
        const result = await updateExpenseAction(expense.id, {
          ...(moneyLocked
            ? {}
            : {
                headId,
                amount: amount as number,
                ...(day && day !== expense.spentOn ? { date: day } : {}),
              }),
          ...details,
        });
        if (!result.ok) return form.setError(result.error);
        router.push(`${accountsHref.expense(expense.id)}?saved=1`);
        return;
      }
      const result = await createExpenseAction({
        headId,
        amount: amount as number,
        date: dayOrNow(values, "date", data.today),
        paymentType: how,
        ...(how === "DUE"
          ? { supplierId: supplier!.id, reference: text("reference") || undefined }
          : payNow
            ? {
                accountId: text("accountId") || undefined,
                method: text("method") || "CASH",
                reference: text("reference") || undefined,
                useAdvance: namesEmployee ? values.get("useAdvance") === "on" : undefined,
              }
            : {}),
        ...details,
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${accountsHref.expense(result.data.id)}?created=1`);
    });
  }

  if (data.heads.length === 0) {
    return (
      <FormAlert tone="note">
        Expenses are filed under heads such as Office rent or Conveyance, and none are active. Ask
        Accounts to add one.
      </FormAlert>
    );
  }

  const outcome = expense
    ? null
    : how === "DUE"
      ? data.can.dueInBooks
        ? "It goes on the supplier's account now; Accounts pays it with their other bills."
        : "It becomes a claim. Once Accounts approves it, it goes on the supplier's account."
      : data.can.payNow
        ? "It goes into the books now, paid from the account you choose."
        : "It becomes a claim. Accounts pays you back once they approve it.";

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      {moneyLocked && (
        <FormAlert tone="note">
          {expense!.number} is in the books, so its head, amount and date stay as they are. Void it
          and record it again to change them.
        </FormAlert>
      )}
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="headId" label="What for" error={fieldError("headId")}>
          <NativeSelect
            id="headId"
            name="headId"
            value={headId}
            onChange={(e) => setHeadId(e.target.value)}
            disabled={moneyLocked}
            containerClassName="sm:w-full"
            aria-invalid={Boolean(fieldError("headId"))}
            aria-describedby={fieldError("headId") ? "headId-error" : undefined}
            autoFocus={!expense}
          >
            <option value="" disabled>
              Choose an expense head
            </option>
            {data.heads.map((h) => (
              <option key={h.id} value={h.id} disabled={!h.isActive && h.id !== expense?.headId}>
                {h.name}
                {h.isActive ? "" : " (archived)"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="amount" label={`Amount (${currency})`} error={fieldError("amount")}>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={expense?.amount}
            disabled={moneyLocked}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("amount"))}
            aria-describedby={fieldError("amount") ? "amount-error" : undefined}
          />
        </Field>
        <Field id="date" label="Spent on" error={fieldError("date")}>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={expense?.spentOn ?? data.today}
            max={data.today}
            disabled={moneyLocked}
          />
        </Field>
      </div>

      {!expense && (
        <div className="grid gap-4">
          {data.can.due && (
            <ChoiceList<How>
              name="paymentType"
              legend="How it was paid"
              defaultValue="CASH_BANK"
              onChange={setHow}
              options={[
                {
                  value: "CASH_BANK",
                  label: data.can.payNow ? "Paid now" : "I paid it",
                  hint: data.can.payNow
                    ? "From cash, a bank account or a wallet."
                    : "Out of your own pocket or petty cash given to you.",
                },
                {
                  value: "DUE",
                  label: "Owed to a supplier",
                  hint: "Their bill is paid later, with their other dues.",
                },
              ]}
            />
          )}
          {outcome && <FormAlert tone="note">{outcome}</FormAlert>}
          {how === "DUE" && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <Field
                id="supplierId"
                label="Owed to"
                error={fieldError("supplierId")}
                className="sm:col-span-2"
              >
                <AccountsPartyPicker
                  id="supplierId"
                  kind="SUPPLIER"
                  purpose="DUE"
                  value={supplier}
                  onChange={setSupplier}
                  invalid={Boolean(fieldError("supplierId"))}
                  describedBy={fieldError("supplierId") ? "supplierId-error" : undefined}
                />
              </Field>
              <Field id="reference" label="Their bill number (optional)">
                <Input id="reference" name="reference" maxLength={120} autoComplete="off" />
              </Field>
            </div>
          )}
          {payNow && (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <PaidFromFields
                idPrefix="expense"
                accounts={data.accounts}
                currency={currency}
                fieldError={fieldError}
              />
            </div>
          )}
        </div>
      )}

      {showEmployee && (
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field
            id="employeeId"
            label={namesEmployee ? "Employee" : "Employee (optional)"}
            error={fieldError("employeeId")}
          >
            <NativeSelect
              id="employeeId"
              name="employeeId"
              defaultValue={expense?.employeeId ?? data.linkedEmployeeId ?? ""}
              containerClassName="sm:w-full"
              aria-invalid={Boolean(fieldError("employeeId"))}
            >
              <option value="">{namesEmployee ? "Choose the employee" : "No one"}</option>
              {data.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </NativeSelect>
          </Field>
          {namesEmployee && (
            <>
              <Field id="fromLocation" label="From (optional)">
                <Input
                  id="fromLocation"
                  name="fromLocation"
                  defaultValue={expense?.fromLocation ?? ""}
                  maxLength={160}
                  autoComplete="off"
                />
              </Field>
              <Field id="toLocation" label="To (optional)">
                <Input
                  id="toLocation"
                  name="toLocation"
                  defaultValue={expense?.toLocation ?? ""}
                  maxLength={160}
                  autoComplete="off"
                />
              </Field>
            </>
          )}
          {namesEmployee && payNow && (
            <label className="flex cursor-pointer items-start gap-2 self-end text-sm sm:pb-2">
              <input
                type="checkbox"
                name="useAdvance"
                defaultChecked
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
              />
              Take it from the employee&apos;s advance first
            </label>
          )}
        </div>
      )}

      <Field
        id="purpose"
        label={namesEmployee ? "Purpose" : "Purpose (optional)"}
        hint={
          namesEmployee ? "Where they went and why: a buyer visit, a fabric pickup." : undefined
        }
        error={fieldError("purpose")}
      >
        <Input
          id="purpose"
          name="purpose"
          defaultValue={expense?.purpose ?? ""}
          maxLength={300}
          autoComplete="off"
          aria-invalid={Boolean(fieldError("purpose"))}
          aria-describedby={
            fieldError("purpose") ? "purpose-error" : namesEmployee ? "purpose-hint" : undefined
          }
        />
      </Field>
      <Field id="description" label="Details (optional)">
        <Textarea
          id="description"
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={expense?.description ?? ""}
        />
      </Field>
      <Field
        id="file"
        label={
          expense?.receipt ? "Replace the receipt (optional)" : "Receipt or memo photo (optional)"
        }
        hint="A photo (JPG, PNG or WebP) or a PDF, up to 10 MB."
        error={fieldError("file")}
      >
        {expense?.receipt && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <PaperclipIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{expense.receipt.fileName}</span>
          </p>
        )}
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

      <FormFooter
        form={form}
        cancelHref={expense ? accountsHref.expense(expense.id) : "/accounts/expenses"}
        submitLabel={
          expense
            ? "Save the changes"
            : how === "CASH_BANK" && !data.can.payNow
              ? "Send the claim"
              : "Record the expense"
        }
        errorTitle="We could not save the expense"
      />
    </form>
  );
}
