"use client";

import { PencilIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { Field, FormAlert } from "@/components/forms/field";
import { readPositive } from "@/components/production/cost-dialogs";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import type { FixedCostsScreen as Screen } from "@/modules/expenses/recurring.service";
import { createFixedCostAction, updateFixedCostAction } from "@/server/actions/accounts.actions";

import { PaidFromFields } from "./money-fields";
import { useNotice } from "./money-actions";
import { Amount } from "./privacy";

type Cost = Screen["items"][number];
const SCOPE = "fixed-costs";

/** A day of the month typed in a box (1 to 31), or a problem on it. */
function readDay(form: FormData, found: Record<string, string>) {
  const day = Number(textOf(form, "dayOfMonth"));
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    found.dayOfMonth = "A day from 1 to 31.";
    return undefined;
  }
  return day;
}

function DayField({
  fieldError,
  defaultValue,
}: {
  fieldError: (n: string) => string | undefined;
  defaultValue?: number;
}) {
  return (
    <Field
      id="fixed-day"
      label="Day of the month"
      hint="31 means the last day in a short month."
      error={fieldError("dayOfMonth")}
    >
      <Input
        id="fixed-day"
        name="dayOfMonth"
        inputMode="numeric"
        defaultValue={defaultValue ?? 1}
        autoComplete="off"
        aria-describedby="fixed-day-hint"
      />
    </Field>
  );
}

/**
 * Monthly fixed costs (accounts.view; Accounts set them up with the PIN): rent,
 * internet, a guard's fee, each recorded as an expense by itself on its day of
 * the month, from its account. A new amount counts from the next month; Stop
 * ends it and keeps it in the list.
 */
export function FixedCostsScreen({ screen, currency }: { screen: Screen; currency: string }) {
  const router = useRouter();
  const { withPin, dialog } = usePinPrompt();
  const [open, setOpen] = useState<
    { kind: "add" } | { kind: "change" | "stop"; cost: Cost } | null
  >(null);
  const [notice, setNotice] = useNotice();
  const m = (fixed: string) => money(fixed, currency);
  const close = () => setOpen(null);
  const done = (message: string) => {
    setOpen(null);
    setNotice(message);
    router.refresh();
  };
  const salaries = screen.items.filter((c) => c.isActive && c.looksLikeSalary);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <dl className="rounded-lg border bg-card p-4 sm:min-w-64">
          <dt className="eyebrow">Every month</dt>
          <dd className="mt-1 font-serif text-xl text-primary tabular-nums">
            <Amount scope={SCOPE}>{m(screen.monthly)}</Amount>
          </dd>
          <dd className="mt-1 text-[0.8125rem] text-muted-foreground">
            An office cost in Profit and loss, never in an order&apos;s costing
          </dd>
        </dl>
        {screen.can.manage && (
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => setOpen({ kind: "add" })}
          >
            <PlusIcon aria-hidden />
            Add a fixed cost
          </Button>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {salaries.length > 0 && (
        <FormAlert tone="note">
          {salaries.map((c) => c.name).join(", ")} looks like a salary. Salaries, the CEO&apos;s
          too, are paid in HR payroll; recording one here as well counts it twice.
        </FormAlert>
      )}

      {screen.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No fixed costs yet. Add the office rent, the internet bill or the guard&apos;s fee once,
          and the ERP records it every month by itself.
        </p>
      ) : (
        <ul className="grid divide-y rounded-lg border bg-card" aria-label="Fixed costs">
          {screen.items.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{c.name}</p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {[
                    c.head,
                    `Day ${c.dayOfMonth} of the month`,
                    c.paidFrom ? `From ${c.paidFrom}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {c.isActive ? (c.nextOn ? `Next on ${formatDay(c.nextOn)}` : "") : "Stopped"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <span className="mr-auto font-medium tabular-nums md:mr-2">
                  <Amount scope={SCOPE}>{m(c.amount)}</Amount>
                </span>
                {screen.can.manage && c.isActive && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setOpen({ kind: "change", cost: c })}
                    >
                      <PencilIcon aria-hidden />
                      Change
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setOpen({ kind: "stop", cost: c })}
                    >
                      <SquareIcon aria-hidden />
                      Stop
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open?.kind === "add" && (
        <FormDialog
          title="Add a monthly fixed cost"
          description="Recorded as an expense by itself on its day each month, from the account chosen. It asks for your PIN."
          submitLabel="Add the fixed cost"
          pendingLabel="Adding"
          errorTitle="We could not add the fixed cost"
          className="sm:max-w-2xl"
          onClose={close}
          onSubmit={async (form) => {
            const found: Record<string, string> = {};
            const name = textOf(form, "name");
            if (name.length < 2) found.name = "Write a short name, like “Office rent”.";
            const headId = textOf(form, "headId");
            if (!headId) found.headId = "Choose the expense head.";
            const amount = readPositive(form, "amount");
            if (typeof amount !== "number") found.amount = amount.fieldErrors?.amount?.[0] ?? "";
            const dayOfMonth = readDay(form, found);
            if (Object.keys(found).length > 0) return problem(found);
            const input = {
              name,
              headId,
              amount,
              dayOfMonth,
              startMonth: textOf(form, "startMonth") || undefined,
              accountId: textOf(form, "accountId") || undefined,
              method: textOf(form, "method") || undefined,
            };
            const result = await withPin((pin) => createFixedCostAction({ ...input, pin }));
            if (!result.ok) return result.error;
            done(`${name} is recorded by itself every month from now on.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field id="fixed-name" label="Name" error={fieldError("name")}>
                <Input
                  id="fixed-name"
                  name="name"
                  maxLength={120}
                  placeholder="Office rent"
                  autoComplete="off"
                />
              </Field>
              <Field id="fixed-head" label="Expense head" error={fieldError("headId")}>
                <NativeSelect
                  id="fixed-head"
                  name="headId"
                  defaultValue=""
                  containerClassName="sm:w-full"
                >
                  <option value="" disabled>
                    Choose a head
                  </option>
                  {screen.heads.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="fixed-amount" label={`Amount (${currency})`} error={fieldError("amount")}>
                <Input
                  id="fixed-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="45000.00"
                  autoComplete="off"
                />
              </Field>
              <DayField fieldError={fieldError} />
              <Field
                id="fixed-start"
                label="First month (optional)"
                hint="Left empty: the first month whose day is still to come."
                error={fieldError("startMonth")}
              >
                <Input
                  id="fixed-start"
                  name="startMonth"
                  type="month"
                  min={screen.thisMonth}
                  aria-describedby="fixed-start-hint"
                />
              </Field>
              <PaidFromFields
                idPrefix="fixed-paid"
                accounts={screen.accounts}
                currency={currency}
                fieldError={fieldError}
              />
            </div>
          )}
        </FormDialog>
      )}

      {open?.kind === "change" && (
        <FormDialog
          title={`Change ${open.cost.name}`}
          description="The new amount or day counts from the next month recorded; past months stay as they were. It asks for your PIN."
          submitLabel="Save the change"
          pendingLabel="Saving"
          errorTitle="We could not save the change"
          onClose={close}
          onSubmit={async (form) => {
            const found: Record<string, string> = {};
            const amount = readPositive(form, "amount");
            if (typeof amount !== "number") found.amount = amount.fieldErrors?.amount?.[0] ?? "";
            const dayOfMonth = readDay(form, found);
            if (Object.keys(found).length > 0) return problem(found);
            const cost = open.cost;
            const result = await withPin((pin) =>
              updateFixedCostAction(cost.id, { amount, dayOfMonth, pin }),
            );
            if (!result.ok) return result.error;
            done(`${cost.name} was changed from the next month.`);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                id="fixed-new-amount"
                label={`Amount (${currency})`}
                error={fieldError("amount")}
              >
                <Input
                  id="fixed-new-amount"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={open.cost.amount}
                  autoComplete="off"
                />
              </Field>
              <DayField fieldError={fieldError} defaultValue={open.cost.dayOfMonth} />
            </div>
          )}
        </FormDialog>
      )}

      {open?.kind === "stop" && (
        <FormDialog
          title={`Stop ${open.cost.name}?`}
          description="It is no longer recorded from next month. What was recorded stays, and it stays in this list as stopped."
          submitLabel="Stop"
          pendingLabel="Stopping"
          destructive
          errorTitle="We could not stop it"
          onClose={close}
          onSubmit={async () => {
            const cost = open.cost;
            const result = await updateFixedCostAction(cost.id, { stop: true });
            if (!result.ok) return result.error;
            done(`${cost.name} was stopped.`);
          }}
        >
          {() => null}
        </FormDialog>
      )}
      {dialog}
    </div>
  );
}
