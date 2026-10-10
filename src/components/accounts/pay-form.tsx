"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { money } from "@/components/sales/labels";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type {
  PartyOption,
  PayForm as PayFormData,
  SupplierDues,
} from "@/modules/accounts/screens.service";
import { getSupplierDuesAction, paySupplierAction } from "@/server/actions/accounts.actions";

import { FormFooter, usePageForm } from "./form-bits";
import { accountsHref, isNegative } from "./labels";
import { AccountsPartyPicker, PaidFromFields } from "./money-fields";

/** What the supplier is owed now and the bills a payment settles, oldest first. */
function Dues({
  dues,
  currency,
  project,
}: {
  dues: SupplierDues;
  currency: string;
  /** The project the payment is for, whose bills it settles first. */
  project: SupplierDues["projects"][number] | null;
}) {
  const owed = !isNegative(dues.payable) && /[1-9]/.test(dues.payable);
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm">
      <p>
        {owed ? (
          <>
            You owe them <span className="font-medium">{money(dues.payable, currency)}</span>.
          </>
        ) : isNegative(dues.payable) ? (
          <>
            They hold an advance of{" "}
            <span className="font-medium">{money(dues.payable, currency)}</span> from you.
          </>
        ) : (
          "Nothing is owed to them; a payment is kept as an advance for their next bill."
        )}
      </p>
      {project ? (
        <p className="text-muted-foreground">
          This payment settles {project.code}&apos;s bills first ({money(project.due, currency)}{" "}
          due); anything over goes to their oldest dues.
        </p>
      ) : (
        dues.openBills.length > 0 && (
          <>
            <p className="text-muted-foreground">A payment settles the oldest first:</p>
            <ul className="grid divide-y" aria-label="Open bills">
              {dues.openBills.map((b) => (
                <li
                  key={b.id}
                  className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0 truncate">
                    {b.number} · {formatDay(b.billOn)}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">
                    {money(b.due, currency)} due
                  </span>
                </li>
              ))}
            </ul>
            {dues.moreBills && <p className="text-muted-foreground">…and more after these.</p>}
          </>
        )
      )}
    </div>
  );
}

/**
 * Pays a supplier on account (Accounts): the supplier, the amount, where the
 * money comes from (cash, a bank account or a wallet) and how. It settles their
 * oldest bills and Due expenses first; anything over stays as an advance.
 */
export function PayForm({ form: data, currency }: { form: PayFormData; currency: string }) {
  const router = useRouter();
  const form = usePageForm();
  const { fieldError } = form;
  const [supplier, setSupplier] = useState<PartyOption | null>(data.supplier?.option ?? null);
  // What the chosen supplier is owed, keyed by supplier so a change loads afresh.
  const [loaded, setLoaded] = useState<{ id: string; dues?: SupplierDues; error?: string } | null>(
    data.supplier ? { id: data.supplier.option.id, dues: data.supplier.dues } : null,
  );
  const supplierId = supplier?.id;

  useEffect(() => {
    if (!supplierId || loaded?.id === supplierId) return;
    let live = true;
    void getSupplierDuesAction(supplierId).then((result) => {
      if (!live) return;
      setLoaded(
        result.ok
          ? { id: supplierId, dues: result.data }
          : { id: supplierId, error: result.error.message },
      );
    });
    return () => {
      live = false;
    };
  }, [supplierId, loaded?.id]);
  const current = loaded && loaded.id === supplierId ? loaded : null;
  const dues = current?.dues ?? null;
  // The project to pay for, if any (reset when the supplier changes).
  const [chosen, setChosen] = useState<{ supplierId: string; projectId: string } | null>(
    data.supplier?.projectId
      ? { supplierId: data.supplier.option.id, projectId: data.supplier.projectId }
      : null,
  );
  const project =
    chosen && chosen.supplierId === supplierId
      ? (dues?.projects.find((p) => p.id === chosen.projectId) ?? null)
      : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    if (!supplier) found.supplierId = "Choose the supplier you are paying.";
    const amount = readPositive(values, "amount");
    if (typeof amount !== "number")
      found.amount = amount.fieldErrors?.amount?.[0] ?? "Enter the amount.";
    if (!textOf(values, "accountId")) found.accountId = "Choose where the money comes from.";
    form.setProblems(found);
    form.setError(undefined);
    if (Object.keys(found).length > 0 || typeof amount !== "number") return;
    form.startTransition(async () => {
      const result = await paySupplierAction({
        supplierId: supplier!.id,
        amount,
        paymentDate: dayOrNow(values, "paymentDate", data.today),
        accountId: textOf(values, "accountId"),
        method: textOf(values, "method") || "CASH",
        projectId: project?.id,
        reference: textOf(values, "reference") || undefined,
        notes: textOf(values, "notes") || undefined,
      });
      if (!result.ok) return form.setError(result.error);
      router.push(`${accountsHref.payment(result.data.id)}?created=1`);
    });
  }

  if (data.accounts.length === 0) {
    return (
      <FormAlert tone="note">
        There is no cash, bank or wallet account to pay from. Add one under Cash & bank first.
      </FormAlert>
    );
  }

  const owed = project
    ? project.due
    : dues && !isNegative(dues.payable) && /[1-9]/.test(dues.payable)
      ? dues.payable
      : "";

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6" noValidate>
      <Field id="supplierId" label="Supplier" error={fieldError("supplierId")}>
        <AccountsPartyPicker
          id="supplierId"
          kind="SUPPLIER"
          purpose="PAY"
          value={supplier}
          onChange={setSupplier}
          invalid={Boolean(fieldError("supplierId"))}
          describedBy={fieldError("supplierId") ? "supplierId-error" : undefined}
          autoFocus={!supplier}
        />
      </Field>
      {supplier &&
        (current?.error ? (
          <FormAlert>{current.error}</FormAlert>
        ) : dues ? (
          <>
            {dues.projects.length > 0 && (
              <Field
                id="pay-project"
                label="Apply to a project (optional)"
                hint="Leave it on the oldest bills, or pick one project to settle its bills first."
              >
                <NativeSelect
                  id="pay-project"
                  value={project?.id ?? ""}
                  onChange={(e) =>
                    setChosen(
                      e.target.value
                        ? { supplierId: supplierId!, projectId: e.target.value }
                        : null,
                    )
                  }
                  containerClassName="sm:w-full"
                  className="md:h-10"
                  aria-describedby="pay-project-hint"
                >
                  <option value="">Oldest bills first</option>
                  {dues.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name} · {money(p.due, currency)} due
                      {p.status === "COMPLETED" ? " (completed)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Dues dues={dues} currency={currency} project={project} />
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            Loading what they are owed
          </p>
        ))}

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="pay-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
          <Input
            key={owed}
            id="pay-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={owed}
            autoComplete="off"
            aria-invalid={Boolean(fieldError("amount"))}
            aria-describedby={fieldError("amount") ? "pay-amount-error" : undefined}
          />
        </Field>
        <Field id="pay-date" label="Paid on" error={fieldError("paymentDate")}>
          <Input
            id="pay-date"
            name="paymentDate"
            type="date"
            defaultValue={data.today}
            max={data.today}
          />
        </Field>
        <PaidFromFields
          idPrefix="pay"
          accounts={data.accounts}
          currency={currency}
          fieldError={fieldError}
        />
      </div>
      <Field id="pay-notes" label="Notes (optional)">
        <Textarea id="pay-notes" name="notes" rows={2} maxLength={1000} />
      </Field>

      <FormFooter
        form={form}
        cancelHref="/accounts/supplier-payments"
        submitLabel="Record the payment"
        pendingLabel="Recording"
        errorTitle="We could not record the payment"
      />
    </form>
  );
}
