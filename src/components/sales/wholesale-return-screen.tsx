"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { Field } from "@/components/forms/field";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { WholesaleReturnScreen as Screen } from "@/modules/sales/wholesale-return.service";
import {
  approveWholesaleReturnAction,
  checkWholesaleReturnAction,
} from "@/server/actions/wholesale-returns.actions";

import { money } from "./labels";
import { WR_STATUS } from "./wholesale-return-list";

/*
 * One wholesale return (2026-11-12): what came back and how, the refund
 * ("Approve") and the QC split ("QC"), each step with who did it and when.
 */

const num = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export function WholesaleReturnScreen({ r }: { r: Screen }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "qc" | null>(null);
  const [split, setSplit] = useState<Record<string, { a: string; b: string; reject: string }>>(() =>
    Object.fromEntries(r.lines.map((l) => [l.id, { a: String(l.quantity), b: "0", reject: "0" }])),
  );
  const close = () => setDialog(null);
  const cur = r.currency;
  const f = r.figures;

  return (
    <section aria-labelledby="wr-title" className="grid min-w-0 gap-6">
      <BackLink href="/sales/wholesale-returns">All wholesale returns</BackLink>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{WR_STATUS[r.status]}</p>
          <h2 id="wr-title" className="mt-1 font-serif text-2xl break-words text-primary">
            {r.number} · {r.buyer.name}
          </h2>
          <p className="mt-1 text-sm break-words text-muted-foreground">
            {r.reason}
            {r.notes ? ` — ${r.notes}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.can.approve && (
            <Button type="button" onClick={() => setDialog("approve")}>
              Approve
            </Button>
          )}
          {r.can.check && (
            <Button type="button" variant="outline" onClick={() => setDialog("qc")}>
              QC
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Fact label="Received">{f.received} pcs</Fact>
        <Fact label="Refunded">{f.refunded} pcs</Fact>
        <Fact label="Exchanged">{f.exchanged} pcs</Fact>
        <Fact label="A-grade">{f.a ?? "-"}</Fact>
        <Fact label="B-grade">{f.b ?? "-"}</Fact>
        <Fact label="Reject">{f.reject ?? "-"}</Fact>
      </dl>

      <Panel title="Steps" id="wr-steps">
        <ul className="mt-3 grid gap-2 text-sm">
          <li className="break-words">
            Received {formatDay(r.receivedOn)}
            {r.receivedBy ? ` by ${r.receivedBy}` : ""} on{" "}
            {r.invoice ? (
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={`/sales/invoices/${r.invoice.id}`}
              >
                {r.invoice.number}
              </Link>
            ) : (
              "the invoice"
            )}
            {r.soldOn
              ? `, sold ${formatDay(r.soldOn)} (${r.daysSinceSale} days after the sale)`
              : ""}
          </li>
          <li className="break-words">
            {r.approvedOn
              ? `Approved ${formatDay(r.approvedOn)}${r.approvedBy ? ` by ${r.approvedBy}` : ""}`
              : "Waiting for approval"}
            {r.approveNote ? ` — ${r.approveNote}` : ""}
            {r.creditNote && (
              <>
                {": credit note "}
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={`/sales/returns/${r.creditNote.id}`}
                >
                  {r.creditNote.number}
                </Link>{" "}
                {money(r.creditNote.amount, cur)}
              </>
            )}
          </li>
          <li className="break-words">
            {r.checkedOn
              ? `QC done ${formatDay(r.checkedOn)}${r.checkedBy ? ` by ${r.checkedBy}` : ""}`
              : "In Returns to check: not sellable until the QC"}
          </li>
          {r.exchange && (
            <li className="break-words">
              Exchange sent on order{" "}
              <Link
                className="text-primary underline-offset-4 hover:underline"
                href={`/sales/orders/${r.exchange.orderId}`}
              >
                {r.exchange.orderNumber}
              </Link>
              {r.exchange.invoice ? `, invoice ${r.exchange.invoice.number}` : ""}
              {r.exchange.challans.length > 0
                ? `, challan ${r.exchange.challans.map((c) => c.number).join(", ")}`
                : ""}
              {r.exchange.total ? ` (${money(r.exchange.total, cur)})` : ""}
            </li>
          )}
        </ul>
      </Panel>

      <Panel title="Lines" id="wr-lines">
        <ul className="mt-3 grid gap-3">
          {r.lines.map((l) => (
            <li key={l.id} className="min-w-0 rounded-md border p-3 text-sm">
              <p className="font-medium break-words">
                {l.sku} · {l.label}
              </p>
              <p className="mt-1 break-words text-muted-foreground">
                {l.quantity} pcs ·{" "}
                {l.mode === "REFUND"
                  ? "Refund"
                  : `Exchange (${l.exchangeKind === "SIZE" ? "Size only" : "Other product"}) for ${l.newQuantity} × ${l.newSku}`}
                {l.unitPrice ? ` · billed ${money(l.unitPrice, cur)} each` : ""}
              </p>
              {l.priceDifference !== null && (
                <p className="mt-1 break-words">
                  Price difference: {money(l.priceDifference, cur)}{" "}
                  {Number(l.priceDifference) > 0
                    ? "(added to the buyer's due)"
                    : Number(l.priceDifference) < 0
                      ? "(the buyer's credit)"
                      : ""}
                </p>
              )}
              <p className="mt-1 break-words">
                Refunded {l.refunded} ·{" "}
                {r.checkedOn ? `A ${l.a} · B ${l.b} · Reject ${l.reject}` : "Not checked yet"}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      {dialog === "approve" && (
        <FormDialog
          title="Approve"
          description={`How many pieces of each line are refunded (all of them unless you lower it). The credit goes on the buyer's account. Over ${money(r.pinAbove, cur)} the PIN is needed.`}
          submitLabel="Approve the refund"
          pendingLabel="Approving"
          errorTitle="The return was not approved"
          onClose={close}
          onSubmit={async (form) => {
            const result = await approveWholesaleReturnAction(r.id, {
              lines: r.lines.map((l) => ({ lineId: l.id, refunded: num(form, `refund-${l.id}`) })),
              reason: num(form, "reason") || undefined,
              pin: num(form, "pin") || undefined,
            });
            if (!result.ok) return result.error;
            router.refresh();
            close();
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              {r.lines.map((l) => (
                <Field
                  key={l.id}
                  id={`refund-${l.id}`}
                  label={`Pieces refunded: ${l.sku} (of ${l.quantity})`}
                  error={fieldError(`lines.${l.id}`)}
                >
                  <Input
                    id={`refund-${l.id}`}
                    name={`refund-${l.id}`}
                    inputMode="numeric"
                    defaultValue={l.quantity}
                  />
                </Field>
              ))}
              <Field
                id="approve-reason"
                label="Why fewer pieces"
                hint="Only when fewer pieces are refunded than came back."
                error={fieldError("reason")}
              >
                <Input id="approve-reason" name="reason" />
              </Field>
              <PinField
                id="approve-pin"
                error={fieldError("pin")}
                hint={`Needed when the refund is over ${money(r.pinAbove, cur)}.`}
              />
            </>
          )}
        </FormDialog>
      )}

      {dialog === "qc" && (
        <FormDialog
          title="QC"
          description="Split each line's pieces into A-grade (back to sellable stock), B-grade (B-grade stock) and Reject (Damage & QC Rejects). The three must add up to the pieces received."
          submitLabel="Save the QC"
          pendingLabel="Saving"
          errorTitle="The QC was not saved"
          onClose={close}
          onSubmit={async (form) => {
            const result = await checkWholesaleReturnAction(r.id, {
              lines: r.lines.map((l) => ({
                lineId: l.id,
                a: num(form, `a-${l.id}`),
                b: num(form, `b-${l.id}`),
                reject: num(form, `reject-${l.id}`),
              })),
            });
            if (!result.ok) return result.error;
            router.refresh();
            close();
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              {r.lines.map((l) => {
                const s = split[l.id]!;
                const total = Number(s.a || 0) + Number(s.b || 0) + Number(s.reject || 0);
                const set = (k: "a" | "b" | "reject", v: string) =>
                  setSplit((all) => ({ ...all, [l.id]: { ...all[l.id]!, [k]: v } }));
                return (
                  <fieldset key={l.id} className="grid min-w-0 gap-2 rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium break-words">
                      {l.sku}: {l.quantity} pcs
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          ["a", "A-grade"],
                          ["b", "B-grade"],
                          ["reject", "Reject"],
                        ] as const
                      ).map(([k, label]) => (
                        <Field key={k} id={`${k}-${l.id}`} label={label}>
                          <Input
                            id={`${k}-${l.id}`}
                            name={`${k}-${l.id}`}
                            inputMode="numeric"
                            value={s[k]}
                            onChange={(e) => set(k, e.target.value)}
                          />
                        </Field>
                      ))}
                    </div>
                    <p
                      className={`text-sm ${total === l.quantity ? "text-muted-foreground" : "text-destructive"}`}
                    >
                      {total} of {l.quantity} pcs
                    </p>
                    {fieldError(`lines.${l.id}`) && (
                      <p className="text-sm text-destructive">{fieldError(`lines.${l.id}`)}</p>
                    )}
                  </fieldset>
                );
              })}
            </>
          )}
        </FormDialog>
      )}
    </section>
  );
}
