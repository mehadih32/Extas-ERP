"use client";

import {
  BanknoteIcon,
  PiggyBankIcon,
  RepeatIcon,
  Undo2Icon,
  ZapIcon,
  ZapOffIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow, readPositive } from "@/components/production/cost-dialogs";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { LenderProfile, LoansPage } from "@/modules/accounts/loans.service";
import type { MoneyAccountOption } from "@/modules/accounts/screens.service";
import {
  payLoanInstallmentAction,
  setAutoPayAction,
  setKeepInCapitalAction,
  termActionAction,
} from "@/server/actions/accounts.actions";

import { loansHref } from "./labels";
import { PaidFromFields } from "./money-fields";
import { useNotice } from "./money-actions";
import { Amount } from "./privacy";

type Loan = LenderProfile["loans"][number];
type TermKind = "RENEW" | "RETURN" | "RETURN_PART";

const TERM_ACTIONS: ReadonlyArray<{ value: TermKind; label: string; icon: typeof RepeatIcon }> = [
  { value: "RENEW", label: "Pay profit & renew", icon: RepeatIcon },
  { value: "RETURN", label: "Pay profit & return money", icon: Undo2Icon },
  { value: "RETURN_PART", label: "Return part", icon: BanknoteIcon },
];

/** The date it was paid and where the money came from, shared by the windows below. */
function PaidFields({
  idPrefix,
  accounts,
  currency,
  today,
  dueDate,
  fieldError,
}: {
  idPrefix: string;
  accounts: readonly MoneyAccountOption[];
  currency: string;
  today: string;
  dueDate: string;
  fieldError: (name: string) => string | undefined;
}) {
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <Field id={`${idPrefix}-date`} label="Paid on" error={fieldError("date")}>
        <Input
          id={`${idPrefix}-date`}
          name="date"
          type="date"
          defaultValue={dueDate < today ? dueDate : today}
          max={today}
        />
      </Field>
      <PaidFromFields
        idPrefix={idPrefix}
        accounts={accounts}
        currency={currency}
        fieldError={fieldError}
      />
    </div>
  );
}

const paidFrom = (form: FormData, today: string) => ({
  date: dayOrNow(form, "date", today),
  accountId: textOf(form, "accountId") || undefined,
  method: textOf(form, "method") || undefined,
  reference: textOf(form, "reference") || undefined,
});

/** Paying one bank or NGO installment now, from cash or a bank. */
function PayInstallmentDialog({
  installment,
  name,
  accounts,
  currency,
  today,
  onDone,
  onClose,
}: {
  installment: { id: string; dueDate: string; amount: string; principal: string; interest: string };
  name: string;
  accounts: readonly MoneyAccountOption[];
  currency: string;
  today: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={`Pay the installment to ${name}`}
      description={`${money(installment.amount, currency)}, due ${formatDay(installment.dueDate)}. The interest part goes to Finance costs; the rest brings down what is owed.`}
      submitLabel="Pay the installment"
      pendingLabel="Paying"
      errorTitle="We could not pay the installment"
      onClose={onClose}
      onSubmit={async (form) => {
        const found: Record<string, string> = {};
        const part = (field: "principalPart" | "interestPart") => {
          const amount = readAmount(textOf(form, field));
          if (amount === "invalid" || amount === null || amount < 0) found[field] = AMOUNT_HINT;
          return typeof amount === "number" ? amount : 0;
        };
        const principalPart = part("principalPart");
        const interestPart = part("interestPart");
        if (Object.keys(found).length > 0) return problem(found);
        const result = await payLoanInstallmentAction(installment.id, {
          principalPart,
          interestPart,
          ...paidFrom(form, today),
        });
        if (!result.ok) return result.error;
        const paid = (principalPart + interestPart).toFixed(2);
        onDone(`The installment of ${money(paid, currency)} to ${name} was paid.`);
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field
              id="pay-principal"
              label={`Principal (${currency})`}
              hint="Change it only when the bank took a different amount this time."
              error={fieldError("principalPart")}
            >
              <Input
                id="pay-principal"
                name="principalPart"
                inputMode="decimal"
                defaultValue={installment.principal}
                autoComplete="off"
                aria-describedby="pay-principal-hint"
              />
            </Field>
            <Field
              id="pay-interest"
              label={`Interest (${currency})`}
              error={fieldError("interestPart")}
            >
              <Input
                id="pay-interest"
                name="interestPart"
                inputMode="decimal"
                defaultValue={installment.interest}
                autoComplete="off"
              />
            </Field>
          </div>
          <PaidFields
            idPrefix="pay-installment"
            accounts={accounts}
            currency={currency}
            today={today}
            dueDate={installment.dueDate}
            fieldError={fieldError}
          />
        </>
      )}
    </FormDialog>
  );
}

/**
 * What falls due in the next month on the Loans & capital page, with "Pay" for
 * a bank or NGO installment; a person's profit opens their profile, where it is
 * paid with Renew or Return.
 */
export function DueSoonList({
  page,
  currency,
}: {
  page: Pick<LoansPage, "dueSoon" | "accounts" | "today" | "can">;
  currency: string;
}) {
  const router = useRouter();
  const [paying, setPaying] = useState<LoansPage["dueSoon"][number] | null>(null);
  const [notice, setNotice] = useNotice();
  return (
    <div className="grid gap-3">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <ul className="grid divide-y rounded-lg border bg-card" aria-label="Due soon">
        {page.dueSoon.map((d) => (
          <li
            key={d.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium break-words">
                {d.lenderId ? (
                  <Link
                    href={loansHref.lender(d.lenderId)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {d.name}
                  </Link>
                ) : (
                  d.name
                )}
              </p>
              <p
                className={`text-[0.8125rem] ${d.overdue ? "text-destructive" : "text-muted-foreground"}`}
              >
                {d.isTerm ? "Profit" : "Installment"} ·{" "}
                {d.overdue
                  ? `Late, was due ${formatDay(d.dueDate)}`
                  : `Due ${formatDay(d.dueDate)}`}
                {d.autoPay ? " · Pays by itself" : ""}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span className="font-medium tabular-nums">
                <Amount scope="loans">{money(d.amount, currency)}</Amount>
              </span>
              {page.can.pay && !d.isTerm && (
                <Button type="button" size="sm" onClick={() => setPaying(d)}>
                  Pay
                </Button>
              )}
              {page.can.pay && d.isTerm && d.lenderId && (
                <Button asChild size="sm" variant="outline">
                  <Link href={loansHref.lender(d.lenderId)}>Open</Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {paying && (
        <PayInstallmentDialog
          installment={paying}
          name={paying.name}
          accounts={page.accounts}
          currency={currency}
          today={page.today}
          onClose={() => setPaying(null)}
          onDone={(message) => {
            setPaying(null);
            setNotice(message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * The buttons on one running loan or term in a lender's profile (Accounts):
 * pay the next installment, or a person's profit with Renew, Return or Return
 * part; installments paying by themselves (PIN to switch on); and whether the
 * loan stays in the owner's capital for ever.
 */
export function LoanActions({
  loan,
  lenderName,
  accounts,
  currency,
  today,
}: {
  loan: Loan;
  lenderName: string;
  accounts: readonly MoneyAccountOption[];
  currency: string;
  today: string;
}) {
  const router = useRouter();
  const { withPin, dialog } = usePinPrompt();
  const [open, setOpen] = useState<"pay" | "autoPay" | "autoPayOff" | "capital" | TermKind | null>(
    null,
  );
  const [notice, setNotice] = useNotice();
  const close = () => setOpen(null);
  const done = (message: string) => {
    setOpen(null);
    setNotice(message);
    router.refresh();
  };
  const next = loan.next;
  const term = TERM_ACTIONS.find((t) => t.value === open);

  return (
    <div className="grid gap-3">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {next && !loan.isTerm && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("pay")}>
            <BanknoteIcon aria-hidden />
            Pay the installment
          </Button>
        )}
        {next &&
          loan.isTerm &&
          TERM_ACTIONS.map((t) => (
            <Button
              key={t.value}
              type="button"
              variant={t.value === "RENEW" ? "default" : "outline"}
              className="w-full sm:w-auto"
              onClick={() => setOpen(t.value)}
            >
              <t.icon aria-hidden />
              {t.label}
            </Button>
          ))}
        {!loan.isTerm && (
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen(loan.autoPay ? "autoPayOff" : "autoPay")}
          >
            {loan.autoPay ? <ZapOffIcon aria-hidden /> : <ZapIcon aria-hidden />}
            {loan.autoPay ? "Stop paying by itself" : "Pay by itself"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => setOpen("capital")}
        >
          <PiggyBankIcon aria-hidden />
          {loan.keepInCapital ? "Take out of my capital" : "Keep in my capital"}
        </Button>
      </div>

      {open === "pay" && next && (
        <PayInstallmentDialog
          installment={next}
          name={lenderName}
          accounts={accounts}
          currency={currency}
          today={today}
          onClose={close}
          onDone={done}
        />
      )}

      {term && next && (
        <FormDialog
          title={`${term.label}: ${lenderName}`}
          description={
            term.value === "RENEW"
              ? `The profit for this term is paid and the ${money(loan.owedNow, currency)} stays for another ${loan.periodMonths} month(s).`
              : term.value === "RETURN"
                ? `The profit is paid and all ${money(loan.owedNow, currency)} goes back. The term closes and stays in the profile.`
                : `The profit is paid, part of the money goes back, and the rest stays for another term with the profit cut in step.`
          }
          submitLabel={term.label}
          pendingLabel="Paying"
          errorTitle="We could not pay it"
          onClose={close}
          onSubmit={async (form) => {
            const found: Record<string, string> = {};
            const profit = readAmount(textOf(form, "profit"));
            if (profit === "invalid" || profit === null || profit < 0) found.profit = AMOUNT_HINT;
            let returnAmount: number | undefined;
            if (term.value === "RETURN_PART") {
              const back = readPositive(form, "returnAmount");
              if (typeof back === "number") returnAmount = back;
              else found.returnAmount = back.fieldErrors?.returnAmount?.[0] ?? AMOUNT_HINT;
            }
            if (Object.keys(found).length > 0) return problem(found);
            const result = await termActionAction(loan.id, {
              action: term.value,
              installmentId: next.id,
              profit: profit as number,
              returnAmount,
              ...paidFrom(form, today),
            });
            if (!result.ok) return result.error;
            done(
              term.value === "RENEW"
                ? `${lenderName}'s profit was paid and the money renewed.`
                : term.value === "RETURN"
                  ? `${lenderName}'s profit and money were paid back. The term is closed.`
                  : `${lenderName}'s profit and ${money(String(returnAmount), currency)} were paid back.`,
            );
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <Field
                  id="term-profit"
                  label={`Profit paid now (${currency})`}
                  hint={`This term's profit: ${money(next.amount, currency)}.`}
                  error={fieldError("profit")}
                >
                  <Input
                    id="term-profit"
                    name="profit"
                    inputMode="decimal"
                    defaultValue={next.amount}
                    autoComplete="off"
                    aria-describedby="term-profit-hint"
                  />
                </Field>
                {term.value === "RETURN_PART" && (
                  <Field
                    id="term-return"
                    label={`Money returned now (${currency})`}
                    hint={`Less than the ${money(loan.owedNow, currency)} owed.`}
                    error={fieldError("returnAmount")}
                  >
                    <Input
                      id="term-return"
                      name="returnAmount"
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      aria-describedby="term-return-hint"
                    />
                  </Field>
                )}
              </div>
              <PaidFields
                idPrefix="term-paid"
                accounts={accounts}
                currency={currency}
                today={today}
                dueDate={next.dueDate}
                fieldError={fieldError}
              />
            </>
          )}
        </FormDialog>
      )}

      {open === "autoPay" && (
        <FormDialog
          title="Pay the installments by themselves?"
          description="On each due day the night's run pays the installment from this account, in your name, and it shows here as paid. It asks for your PIN."
          submitLabel="Pay by itself"
          pendingLabel="Saving"
          errorTitle="We could not switch it on"
          onClose={close}
          onSubmit={async (form) => {
            const result = await withPin((pin) =>
              setAutoPayAction(loan.id, {
                on: true,
                accountId: textOf(form, "accountId") || undefined,
                method: textOf(form, "method") || undefined,
                pin,
              }),
            );
            if (!result.ok) return result.error;
            done(`${lenderName}'s installments now pay by themselves on their due day.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <PaidFromFields
                idPrefix="auto-pay"
                accounts={accounts}
                currency={currency}
                fieldError={fieldError}
              />
            </div>
          )}
        </FormDialog>
      )}

      {open === "autoPayOff" && (
        <FormDialog
          title="Stop paying by itself?"
          description="The installments stay on the list; pay each one with “Pay the installment”."
          submitLabel="Stop paying by itself"
          pendingLabel="Saving"
          errorTitle="We could not switch it off"
          onClose={close}
          onSubmit={async () => {
            const result = await setAutoPayAction(loan.id, { on: false });
            if (!result.ok) return result.error;
            done(`${lenderName}'s installments no longer pay by themselves.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}

      {open === "capital" && (
        <FormDialog
          title={
            loan.keepInCapital
              ? "Take it out of your capital?"
              : "Keep it in your capital for ever?"
          }
          description={
            loan.keepInCapital
              ? "The money working in the business then counts only what is still owed, and it goes down as the loan is repaid."
              : "The money working in the business keeps the whole loan for ever. The repayments come out of profit and show under Net profit as “Loan installments paid”."
          }
          submitLabel={loan.keepInCapital ? "Take out of my capital" : "Keep in my capital"}
          pendingLabel="Saving"
          errorTitle="We could not change it"
          onClose={close}
          onSubmit={async () => {
            const result = await setKeepInCapitalAction(loan.id, {
              keepInCapital: !loan.keepInCapital,
            });
            if (!result.ok) return result.error;
            done(
              loan.keepInCapital
                ? `${lenderName}'s loan no longer counts in your capital.`
                : `${lenderName}'s loan now counts in your capital for ever.`,
            );
          }}
        >
          {() => null}
        </FormDialog>
      )}
      {dialog}
    </div>
  );
}
