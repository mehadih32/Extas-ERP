"use client";

import { FileTextIcon } from "lucide-react";

import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { isZero, money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { Clearance } from "@/modules/hr/exit.service";
import { deactivateEmployeeAction, remakeCertificateAction } from "@/server/actions/hr.actions";

import { hrHref } from "./labels";

const smallText = "text-[0.8125rem] text-muted-foreground";
const linkClass = "text-primary underline-offset-4 hover:underline";

/** "Laptop (LT-0042)". */
const itemText = (a: { name: string; tag: string | null }) =>
  a.tag ? `${a.name} (${a.tag})` : a.name;

/**
 * Where someone stands for leaving or has left: deactivated already (login
 * off, a certificate made or being made). Until then the dialog deactivates.
 */
export function isDeactivated(c: Clearance) {
  const left = c.employee.exitDate !== null && c.employee.exitDate <= c.today;
  return left && !c.login?.active && (c.certificates.length > 0 || c.making);
}

/** The money either way on leaving, in plain words. */
function MoneyCheck({ c, currency }: { c: Clearance; currency: string }) {
  const rows = [
    {
      label: "Salary still to pay them",
      value: isZero(c.salaryOwed) ? "Nothing" : money(c.salaryOwed, currency),
    },
    {
      label: "Advances they still owe",
      value: isZero(c.advancesOwed)
        ? "Nothing"
        : `${money(c.advancesOwed, currency)}, taken from their last salary`,
    },
    {
      label: "Claims to pay them back",
      value: `${isZero(c.claimsOwed) ? "Nothing" : money(c.claimsOwed, currency)}${
        c.claimsWaiting > 0 ? `; ${c.claimsWaiting} waiting for Accounts` : ""
      }`,
    },
  ];
  return (
    <div className="grid gap-2">
      <dl className="grid gap-1.5 rounded-md border p-3 text-sm" aria-label="Money on leaving">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
      {c.finalPayrollMissing && (
        <p className={smallText}>
          Their {c.finalPayrollMissing} salary comes with that month&apos;s payroll, not approved
          yet. Make the certificate again once it is paid, so it shows everything settled.
        </p>
      )}
    </div>
  );
}

function loginText(c: Clearance) {
  const login = c.login;
  if (!login) return "They have no login.";
  if (!login.active) return `Their login (${login.email}) is already switched off.`;
  if (login.canSwitchOff) return `Their login (${login.email}) is switched off.`;
  return `Their login (${login.email}) is a ${login.role} login: it stays on until someone who manages users switches it off in Settings > Users.`;
}

/**
 * "Deactivate employee" (hr.manage): the clearance check first (company items
 * still out hold it up; money either way is shown), then the last working day
 * (today or earlier). It records the leaving day, switches the login off and
 * has the Experience & Clearance Certificate made. Once done, the same dialog
 * lists the certificates and makes one again.
 */
export function DeactivateDialog({
  clearance: c,
  currency,
  onClose,
  onDone,
}: {
  clearance: Clearance;
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const e = c.employee;

  if (c.items.length > 0) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Take the company items back first</DialogTitle>
            <DialogDescription>
              {e.name} still {c.items.length === 1 ? "has this item" : "has these items"}. Mark each
              one returned, damaged or lost under “Company items” on this page, then deactivate
              them.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-1.5 rounded-md border p-3 text-sm" aria-label="Items still out">
            {c.items.map((i) => (
              <li key={i.id}>
                {itemText(i)}
                <span className={`block ${smallText}`}>Given {formatDay(i.issuedOn)}</span>
              </li>
            ))}
          </ul>
          <MoneyCheck c={c} currency={currency} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button asChild>
              <a href="#items-heading" onClick={onClose}>
                Go to the items
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (isDeactivated(c)) {
    return (
      <FormDialog
        title="Experience & Clearance Certificate"
        description={`${e.name} left on ${formatDay(e.exitDate!)}. ${loginText(c)}`}
        submitLabel="Make the certificate again"
        pendingLabel="Asking"
        errorTitle="We could not make the certificate"
        onClose={onClose}
        onSubmit={async () => {
          const result = await remakeCertificateAction(e.id);
          if (!result.ok) return result.error;
          onDone(
            `A new certificate for ${e.name} is being made. It shows in their papers in a moment.`,
          );
        }}
      >
        {() => (
          <>
            {c.certificates.length > 0 && (
              <ul className="grid gap-2" aria-label="Certificates">
                {c.certificates.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <a
                      href={hrHref.file(d.fileId)}
                      target="_blank"
                      rel="noreferrer"
                      className={linkClass}
                    >
                      {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {c.making && (
              <FormAlert tone="note">
                A certificate is being made. Open this again in a moment to see it.
              </FormAlert>
            )}
            <MoneyCheck c={c} currency={currency} />
            {!c.finalPayrollMissing && (
              <p className={smallText}>
                Make it again after their final salary or claims are paid, so it shows the dues
                settled. Each one is kept in their papers.
              </p>
            )}
          </>
        )}
      </FormDialog>
    );
  }

  const leavingLater = e.exitDate !== null && e.exitDate > c.today;
  return (
    <FormDialog
      title={`Deactivate ${e.name}?`}
      description={`This records their last working day, ${
        c.login?.active ? "switches their login off " : ""
      }and makes the Experience & Clearance Certificate (kept in their papers). They are paid up to their last day; what they owe on advances comes off their last salary.`}
      submitLabel="Deactivate"
      pendingLabel="Deactivating"
      destructive
      errorTitle="We could not deactivate them"
      className="sm:max-w-xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const exitDate = textOf(form, "exitDate");
        if (!exitDate) return problem({ exitDate: "Choose their last working day." });
        if (exitDate > c.today) return problem({ exitDate: "Pick today or an earlier day." });
        const result = await deactivateEmployeeAction(e.id, {
          exitDate,
          status: textOf(form, "status") || "RESIGNED",
          reason: textOf(form, "reason") || null,
        });
        if (!result.ok) return result.error;
        const { login, loginRole, loginProblem } = result.data;
        onDone(
          `${e.name} is deactivated, last working day ${formatDay(exitDate)}.${
            login === "OFF"
              ? " Their login is switched off."
              : login === "KEPT"
                ? ` Their ${loginRole ?? ""} login stays on${loginProblem ? `: ${loginProblem}` : ": someone who manages users switches it off"}.`
                : ""
          } The certificate is being made and shows in their papers in a moment.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <FormAlert tone="success">Clearance: no company items are with them.</FormAlert>
          <MoneyCheck c={c} currency={currency} />
          <p className="text-sm">{loginText(c)}</p>
          <ChoiceList
            name="status"
            legend="Why they are leaving"
            defaultValue={e.status === "TERMINATED" ? "TERMINATED" : "RESIGNED"}
            options={[
              { value: "RESIGNED", label: "They resigned" },
              { value: "TERMINATED", label: "Their job was ended" },
            ]}
          />
          <Field
            id="deactivate-date"
            label="Last working day"
            hint={
              leavingLater
                ? `Their leaving day is ${formatDay(e.exitDate!)}. Deactivating now ends their job on the day you pick; or wait and deactivate them on the day.`
                : "Today or an earlier day."
            }
            error={fieldError("exitDate")}
          >
            <Input
              id="deactivate-date"
              name="exitDate"
              type="date"
              defaultValue={e.exitDate && !leavingLater ? e.exitDate : c.today}
              min={e.joinDate}
              max={c.today}
              aria-invalid={Boolean(fieldError("exitDate"))}
            />
          </Field>
          <Field id="deactivate-reason" label="Note (optional)" error={fieldError("reason")}>
            <Textarea
              id="deactivate-reason"
              name="reason"
              rows={2}
              maxLength={300}
              defaultValue={e.exitReason ?? undefined}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
