"use client";

import type { StaffClaimKind } from "@prisma/client";
import {
  BanknoteIcon,
  CheckCheckIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useState, useTransition } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { readPositive } from "@/components/production/cost-dialogs";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { MoneyAccountOption } from "@/modules/accounts/screens.service";
import type { ClaimsLedger, MyClaimsScreen } from "@/modules/hr/claims.service";
import {
  approveAllClaimsAction,
  decideClaimAction,
  payBackClaimsAction,
  recheckClaimAction,
} from "@/server/actions/hr.actions";
import {
  submitMyClaimAction,
  uploadMyClaimReceiptAction,
  withdrawMyClaimAction,
} from "@/server/actions/portal.actions";

import { CLAIM_KIND_LABELS, claimTitle } from "./claim-labels";
import { useNotice } from "./use-notice";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Row = ClaimsLedger["rows"][number];

/**
 * Claiming money back from My HR: a trip (the day, from, to, what for and the
 * fare) or local material bought for a production project (what, how much,
 * the shop and the price), with a receipt photo.
 */
export function NewClaim({
  today,
  projects,
  places,
  recentRoutes,
}: Pick<MyClaimsScreen, "today" | "projects" | "places" | "recentRoutes">) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<StaffClaimKind>("CONVEYANCE");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useNotice();
  const suggestions = [
    ...new Set([...places, ...recentRoutes.flatMap((r) => [r.from, r.to])]),
  ].slice(0, 30);

  return (
    <div className="grid gap-3">
      <div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => {
            setFile(null);
            setKind("CONVEYANCE");
            setOpen(true);
          }}
        >
          <PlusIcon aria-hidden />
          New claim
        </Button>
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title="Claim money back"
          description="For money you paid yourself for the company. Accounts checks it and pays you back."
          submitLabel="Send the claim"
          pendingLabel="Sending"
          errorTitle="We could not send your claim"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const found: Record<string, string> = {};
            const text = (name: string) => textOf(form, name);
            const amount = readPositive(form, "amount");
            if (typeof amount !== "number") {
              found.amount = amount.fieldErrors?.amount?.[0] ?? "Enter the amount.";
            }
            const date = text("date");
            if (!date) found.date = "Choose the day.";
            else if (date > today) found.date = "The day can't be after today.";
            if (kind === "CONVEYANCE") {
              if (text("fromPlace").length < 2) found.fromPlace = "Write where you started.";
              if (text("toPlace").length < 2) found.toPlace = "Write where you went.";
              if (text("purpose").length < 3) found.purpose = "Say what the trip was for.";
            } else {
              if (!text("projectId")) found.projectId = "Choose the production project.";
              if (text("item").length < 2) found.item = "Write what you bought.";
            }
            if (file && file.size > MAX_FILE_BYTES) found.file = "Files can be up to 10 MB.";
            if (Object.keys(found).length > 0) return problem(found);
            let receiptFileId: string | null = null;
            if (file) {
              const upload = new FormData();
              upload.set("file", file);
              const stored = await uploadMyClaimReceiptAction(upload);
              if (!stored.ok) return problem({ file: stored.error.message });
              receiptFileId = stored.data.id;
            }
            const result = await submitMyClaimAction(
              kind === "CONVEYANCE"
                ? {
                    kind,
                    date,
                    amount,
                    fromPlace: text("fromPlace"),
                    toPlace: text("toPlace"),
                    purpose: text("purpose"),
                    receiptFileId,
                  }
                : {
                    kind,
                    date,
                    amount,
                    projectId: text("projectId"),
                    item: text("item"),
                    quantity: text("quantity") || null,
                    shop: text("shop") || null,
                    purpose: text("purpose") || null,
                    receiptFileId,
                  },
            );
            if (!result.ok) return result.error;
            setNotice(`Claim ${result.data.number} is sent to Accounts.`);
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <>
              <ChoiceList
                name="kind"
                legend="What is it for?"
                defaultValue={kind}
                onChange={setKind}
                options={[
                  {
                    value: "CONVEYANCE",
                    label: CLAIM_KIND_LABELS.CONVEYANCE,
                    hint: "A trip for work: rickshaw, CNG, bus, ride share.",
                  },
                  ...(projects.length > 0
                    ? [
                        {
                          value: "LOCAL_MATERIAL" as const,
                          label: CLAIM_KIND_LABELS.LOCAL_MATERIAL,
                          hint: "Yarn, buttons or other material you bought for a production project.",
                        },
                      ]
                    : []),
                ]}
              />
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field id="claim-date" label="Day" error={fieldError("date")}>
                  <Input
                    id="claim-date"
                    name="date"
                    type="date"
                    defaultValue={today}
                    max={today}
                    aria-invalid={Boolean(fieldError("date"))}
                  />
                </Field>
                <Field
                  id="claim-amount"
                  label={kind === "CONVEYANCE" ? "Fare" : "Price paid"}
                  hint={AMOUNT_HINT}
                  error={fieldError("amount")}
                >
                  <Input
                    id="claim-amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("amount"))}
                  />
                </Field>
              </div>
              {kind === "CONVEYANCE" ? (
                <>
                  <div className="grid items-start gap-5 sm:grid-cols-2">
                    <Field id="claim-from" label="From" error={fieldError("fromPlace")}>
                      <Input
                        id="claim-from"
                        name="fromPlace"
                        list="claim-places"
                        maxLength={160}
                        autoComplete="off"
                        aria-invalid={Boolean(fieldError("fromPlace"))}
                      />
                    </Field>
                    <Field id="claim-to" label="To" error={fieldError("toPlace")}>
                      <Input
                        id="claim-to"
                        name="toPlace"
                        list="claim-places"
                        maxLength={160}
                        autoComplete="off"
                        aria-invalid={Boolean(fieldError("toPlace"))}
                      />
                    </Field>
                  </div>
                  <datalist id="claim-places">
                    {suggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <Field
                    id="claim-purpose"
                    label="What the trip was for"
                    error={fieldError("purpose")}
                  >
                    <Input
                      id="claim-purpose"
                      name="purpose"
                      maxLength={300}
                      placeholder="Took samples to the buyer"
                      aria-invalid={Boolean(fieldError("purpose"))}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    id="claim-project"
                    label="Production project"
                    error={fieldError("projectId")}
                  >
                    <NativeSelect
                      id="claim-project"
                      name="projectId"
                      defaultValue=""
                      containerClassName="sm:w-full"
                      aria-invalid={Boolean(fieldError("projectId"))}
                    >
                      <option value="" disabled>
                        Choose the project
                      </option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} · {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <div className="grid items-start gap-5 sm:grid-cols-2">
                    <Field id="claim-item" label="What you bought" error={fieldError("item")}>
                      <Input
                        id="claim-item"
                        name="item"
                        maxLength={160}
                        placeholder="Yarn"
                        aria-invalid={Boolean(fieldError("item"))}
                      />
                    </Field>
                    <Field
                      id="claim-quantity"
                      label="How much (optional)"
                      error={fieldError("quantity")}
                    >
                      <Input
                        id="claim-quantity"
                        name="quantity"
                        maxLength={80}
                        placeholder="5 kg"
                      />
                    </Field>
                  </div>
                  <Field id="claim-shop" label="Shop (optional)" error={fieldError("shop")}>
                    <Input id="claim-shop" name="shop" maxLength={160} />
                  </Field>
                  <Field id="claim-note" label="Note (optional)" error={fieldError("purpose")}>
                    <Input id="claim-note" name="purpose" maxLength={300} />
                  </Field>
                </>
              )}
              <Field
                id="claim-file"
                label={kind === "CONVEYANCE" ? "Receipt (optional)" : "Receipt or memo photo"}
                hint="A photo or PDF, up to 10 MB."
                error={fieldError("file")}
              >
                <Input
                  id="claim-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="h-auto py-1.5 file:mr-3"
                  aria-invalid={Boolean(fieldError("file"))}
                  aria-describedby={fieldError("file") ? "claim-file-error" : "claim-file-hint"}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}

/** Taking back one's own claim while Accounts has not decided it. */
export function WithdrawClaim({ id, what }: { id: string; what: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();

  if (notice) return <FormAlert tone="success">{notice}</FormAlert>;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        aria-label={`Withdraw ${what}`}
      >
        <Undo2Icon aria-hidden />
        Withdraw
      </Button>
      {open && (
        <FormDialog
          title="Withdraw this claim?"
          description={`${what}. Accounts sees that you withdrew it.`}
          submitLabel="Withdraw"
          pendingLabel="Withdrawing"
          destructive
          errorTitle="We could not withdraw the claim"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const result = await withdrawMyClaimAction(id);
            if (!result.ok) return result.error;
            setOpen(false);
            setNotice("Withdrawn.");
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </>
  );
}

type Dialog = "change" | "reject" | null;

/**
 * Accounts' buttons on a waiting claim: approve it as claimed, change the
 * amount (with a reason) or the production cost head and approve, reject it
 * (with a reason), or run its checks again.
 */
export function ClaimDecisions({
  row,
  costHeads,
  defaultHead,
  currency,
}: {
  row: Row;
  costHeads: ClaimsLedger["costHeads"];
  defaultHead: ClaimsLedger["defaultHead"];
  currency: string;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [notice, setNotice] = useNotice();
  const name = row.employee.name;
  const amount = money(row.amount, currency);
  const what = `${row.number}, ${name}, ${formatDay(row.date)}`;

  function run(
    work: () => Promise<{ ok: true } | { ok: false; error: ActionError }>,
    done: string,
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) return setError(result.error);
      setNotice(done);
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={row.flags.length > 0 ? "outline" : "default"}
          disabled={pending}
          onClick={() =>
            run(
              () => decideClaimAction(row.id, { decision: "APPROVE" }),
              `${amount} approved for ${name}.`,
            )
          }
          aria-label={`Approve ${amount} for ${what}`}
        >
          <CheckIcon aria-hidden />
          Approve {amount}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setDialog("change")}
          aria-label={`Change and approve ${what}`}
        >
          <PencilIcon aria-hidden />
          Change and approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => setDialog("reject")}
          aria-label={`Reject ${what}`}
        >
          <XIcon aria-hidden />
          Reject
        </Button>
        {row.can.recheck && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => recheckClaimAction(row.id), "Checked again.")}
            aria-label={`Check ${what} again`}
          >
            <RefreshCwIcon aria-hidden />
            Check again
          </Button>
        )}
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the claim"
          onClose={() => setError(undefined)}
        />
      )}

      {dialog === "change" && (
        <FormDialog
          title={`Approve ${name}'s claim`}
          description={`${row.number}: ${claimTitle(row)}, ${amount} claimed. Approving puts it in the books and owes it to ${name} until Accounts pays it back.`}
          submitLabel="Approve"
          pendingLabel="Approving"
          errorTitle="We could not approve the claim"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const found: Record<string, string> = {};
            const value = readAmount(textOf(form, "amount"));
            const reason = textOf(form, "reason");
            if (value === "invalid") found.amount = AMOUNT_HINT;
            else if (value === null || value <= 0) found.amount = "Enter the amount to approve.";
            else if (value > Number(row.amount)) found.amount = `At most the ${amount} claimed.`;
            else if (value < Number(row.amount) && reason.length < 5) {
              found.reason = "Say why less than the amount claimed is approved.";
            }
            if (Object.keys(found).length > 0) return problem(found);
            const costHeadId = textOf(form, "costHeadId");
            const result = await decideClaimAction(row.id, {
              decision: "APPROVE",
              amount: value as number,
              ...(reason ? { reason } : {}),
              ...(row.kind === "LOCAL_MATERIAL" && costHeadId ? { costHeadId } : {}),
            });
            if (!result.ok) return result.error;
            setNotice(`${money(String(value), currency)} approved for ${name}.`);
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <>
              <Field
                id={`claim-approve-amount-${row.id}`}
                label="Amount to approve"
                hint={`Up to the ${amount} claimed.`}
                error={fieldError("amount")}
              >
                <Input
                  id={`claim-approve-amount-${row.id}`}
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={row.amount}
                  aria-invalid={Boolean(fieldError("amount"))}
                />
              </Field>
              <Field
                id={`claim-approve-reason-${row.id}`}
                label="Reason"
                hint="Needed when less is approved. The employee sees it."
                error={fieldError("reason")}
              >
                <Input
                  id={`claim-approve-reason-${row.id}`}
                  name="reason"
                  maxLength={300}
                  aria-invalid={Boolean(fieldError("reason"))}
                />
              </Field>
              {row.kind === "LOCAL_MATERIAL" && (
                <Field
                  id={`claim-approve-head-${row.id}`}
                  label="Cost head on the project"
                  error={fieldError("costHeadId")}
                >
                  <NativeSelect
                    id={`claim-approve-head-${row.id}`}
                    name="costHeadId"
                    defaultValue={defaultHead.id ?? ""}
                    containerClassName="sm:w-full"
                  >
                    {defaultHead.id === null && <option value="">{defaultHead.name} (new)</option>}
                    {costHeads.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </>
          )}
        </FormDialog>
      )}

      {dialog === "reject" && (
        <FormDialog
          title={`Reject ${name}'s claim?`}
          description={`${row.number}: ${claimTitle(row)}, ${amount}. Nothing goes in the books, and ${name} sees the reason.`}
          submitLabel="Reject"
          pendingLabel="Rejecting"
          destructive
          errorTitle="We could not reject the claim"
          onClose={() => setDialog(null)}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await decideClaimAction(row.id, { decision: "REJECT", reason });
            if (!result.ok) return result.error;
            setNotice(`The claim from ${name} is rejected.`);
            setDialog(null);
          }}
        >
          {(fieldError) => (
            <ReasonField
              id={`claim-reject-${row.id}`}
              min={5}
              hint="The employee sees it."
              error={fieldError("reason")}
            />
          )}
        </FormDialog>
      )}
    </div>
  );
}

/**
 * "Approve all with nothing to check": the month's waiting claims with no
 * flag. Flagged claims wait to be looked at one by one.
 */
export function ApproveAllClaims({
  month,
  label,
  count,
  needsLook,
}: {
  month: string;
  label: string;
  count: number;
  needsLook: number;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  if (count === 0 && !notice) return null;
  return (
    <div className="grid gap-2">
      {count > 0 && (
        <div>
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
            <CheckCheckIcon aria-hidden />
            Approve all with nothing to check ({count})
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {open && (
        <FormDialog
          title={`Approve ${count} ${count === 1 ? "claim" : "claims"} as claimed?`}
          description={`The claims from ${label} with no flag go in the books and are owed to the staff who made them. Local material goes under its project's "Local Materials" costs.${
            needsLook > 0
              ? ` ${needsLook} flagged ${needsLook === 1 ? "claim waits" : "claims wait"} for you to look at ${needsLook === 1 ? "it" : "them"} one by one.`
              : ""
          }`}
          submitLabel="Approve all"
          pendingLabel="Approving"
          errorTitle="We could not approve the claims"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const result = await approveAllClaimsAction({ month });
            if (!result.ok) return result.error;
            const n = result.data.approved;
            setNotice(`${n} ${n === 1 ? "claim" : "claims"} approved.`);
            setOpen(false);
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}

/** Accounts pays an employee back everything approved and owed to them. */
export function PayBackClaims({
  employee,
  count,
  amount,
  accounts,
  currency,
  today,
}: {
  employee: { id: string; name: string };
  count: number;
  amount: string;
  accounts: readonly MoneyAccountOption[];
  currency: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  if (notice) return <FormAlert tone="success">{notice}</FormAlert>;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={`Pay ${employee.name} back ${money(amount, currency)}`}
      >
        <BanknoteIcon aria-hidden />
        Pay back
      </Button>
      {open && (
        <FormDialog
          title={`Pay ${employee.name} back?`}
          description={`${count} approved ${count === 1 ? "claim" : "claims"}, ${money(amount, currency)} in all, paid out of the account you choose.`}
          submitLabel="Record the payment"
          pendingLabel="Recording"
          errorTitle="We could not record the payment"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const date = textOf(form, "date");
            const result = await payBackClaimsAction({
              employeeId: employee.id,
              accountId: textOf(form, "accountId") || undefined,
              method: textOf(form, "method") || "CASH",
              reference: textOf(form, "reference") || null,
              date: date && date !== today ? date : undefined,
            });
            if (!result.ok) return result.error;
            setNotice(
              `${money(result.data.amount, currency)} paid back to ${employee.name} (${result.data.entryNumber}).`,
            );
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <div className="grid items-start gap-5 sm:grid-cols-2">
              <PaidFromFields
                idPrefix={`claims-pay-${employee.id}`}
                accounts={accounts}
                currency={currency}
                fieldError={fieldError}
              />
              <Field
                id={`claims-pay-date-${employee.id}`}
                label="Paid on"
                error={fieldError("date")}
              >
                <Input
                  id={`claims-pay-date-${employee.id}`}
                  name="date"
                  type="date"
                  defaultValue={today}
                  max={today}
                />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
    </>
  );
}
