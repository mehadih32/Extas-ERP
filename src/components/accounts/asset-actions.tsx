"use client";

import { BanIcon, CalculatorIcon, PencilIcon, TagIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { dayOrNow } from "@/components/production/cost-dialogs";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay } from "@/lib/display";
import type { AssetRegister, AssetScreen } from "@/modules/accounts/asset-screens.service";
import {
  disposeFixedAssetAction,
  runDepreciationAction,
  voidFixedAssetAction,
} from "@/server/actions/accounts.actions";

import { assetHref } from "./labels";
import { PaidFromFields } from "./money-fields";
import { useNotice } from "./money-actions";
import { Amount } from "./privacy";

/**
 * On the register: depreciation up to the end of last month that is not in the
 * books yet, and the button that posts it (Accounts). Posting twice for the
 * same month posts nothing new.
 */
export function DepreciationDue({
  depreciation,
  canPost,
  currency,
}: {
  depreciation: AssetRegister["depreciation"];
  canPost: boolean;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  const d = depreciation;
  const due = d.assets.length > 0;
  if (!due && !notice) return null;

  return (
    <div className="grid gap-3">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {due && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-relaxed">
            Depreciation up to {formatDay(d.through)} is not in the books yet:{" "}
            <span className="font-medium">
              <Amount scope="register">{money(d.total, currency)}</Amount>
            </span>{" "}
            on {d.assets.length} {d.assets.length === 1 ? "asset" : "assets"}.
          </p>
          {canPost && (
            <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
              <CalculatorIcon aria-hidden />
              Post depreciation
            </Button>
          )}
        </div>
      )}
      {open && (
        <FormDialog
          title={`Post depreciation up to ${formatDay(d.through)}?`}
          description="Each asset's value goes down by its share for the months not yet counted. The amounts go to Depreciation in Profit and loss."
          submitLabel="Post depreciation"
          pendingLabel="Posting"
          errorTitle="We could not post depreciation"
          onClose={() => setOpen(false)}
          onSubmit={async () => {
            const result = await runDepreciationAction({ through: d.through });
            if (!result.ok) return result.error;
            setOpen(false);
            setNotice(
              `Depreciation of ${money(result.data.total, currency)} was posted on ${result.data.items.length} ${
                result.data.items.length === 1 ? "asset" : "assets"
              }.`,
            );
            router.refresh();
          }}
        >
          {() => (
            <ul aria-label="Depreciation to post" className="grid divide-y text-sm">
              {d.assets.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 break-words">{a.name}</span>
                  <span className="shrink-0 tabular-nums">{money(a.amount, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </FormDialog>
      )}
    </div>
  );
}

/** Selling or scrapping it, and removing one entered by mistake (Accounts). */
export function AssetActions({
  screen,
  currency,
  notice: initialNotice,
}: {
  screen: AssetScreen;
  currency: string;
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"dispose" | "remove" | null>(null);
  const [notice, setNotice] = useNotice(initialNotice);
  const { asset: a, can } = screen;
  const close = () => setOpen(null);
  if (!can.edit && !notice) return null;

  return (
    <div className="grid gap-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {can.edit && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={assetHref.edit(a.id)}>
              <PencilIcon aria-hidden />
              Change details
            </Link>
          </Button>
          {can.dispose && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setOpen("dispose")}
            >
              <TagIcon aria-hidden />
              Sell or scrap
            </Button>
          )}
          {can.remove && (
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive hover:text-destructive sm:w-auto"
              onClick={() => setOpen("remove")}
            >
              <BanIcon aria-hidden />
              Remove
            </Button>
          )}
        </div>
      )}
      {open === "dispose" && (
        <FormDialog
          title={`Sell or scrap ${a.name}?`}
          description={`Depreciation is counted up to the day before, then it leaves the register. Its value in the books now is ${money(a.bookValue, currency)}: selling for more is a gain, for less a loss.`}
          submitLabel="Record it"
          pendingLabel="Recording"
          errorTitle="We could not record it"
          onClose={close}
          onSubmit={async (form) => {
            const proceeds = can.sell ? readAmount(textOf(form, "proceeds")) : 0;
            if (proceeds === "invalid") return problem({ proceeds: AMOUNT_HINT });
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await disposeFixedAssetAction(a.id, {
              date: dayOrNow(form, "date", screen.today),
              proceeds: proceeds ?? 0,
              ...(proceeds
                ? {
                    accountId: textOf(form, "accountId") || undefined,
                    method: textOf(form, "method") || "CASH",
                    reference: textOf(form, "reference") || undefined,
                  }
                : {}),
              reason,
            });
            if (!result.ok) return result.error;
            close();
            setNotice(proceeds ? `${a.name} was sold.` : `${a.name} was scrapped.`);
            router.refresh();
          }}
        >
          {(fieldError) => (
            <>
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field id="dispose-date" label="On" error={fieldError("date")}>
                  <Input
                    id="dispose-date"
                    name="date"
                    type="date"
                    defaultValue={screen.today}
                    min={a.boughtOn}
                    max={screen.today}
                  />
                </Field>
                {can.sell && (
                  <Field
                    id="dispose-proceeds"
                    label={`Sold for (${currency})`}
                    hint="Leave empty if it was scrapped."
                    error={fieldError("proceeds")}
                  >
                    <Input
                      id="dispose-proceeds"
                      name="proceeds"
                      inputMode="decimal"
                      placeholder="0.00"
                      autoComplete="off"
                      aria-describedby={
                        fieldError("proceeds") ? "dispose-proceeds-error" : "dispose-proceeds-hint"
                      }
                    />
                  </Field>
                )}
                {can.sell && screen.accounts.length > 0 && (
                  <PaidFromFields
                    idPrefix="dispose"
                    label="Money received into"
                    accounts={screen.accounts}
                    currency={currency}
                    fieldError={fieldError}
                  />
                )}
              </div>
              {!can.sell && (
                <FormAlert tone="note">
                  Selling it for money needs the permission to receive money; it can be scrapped
                  here.
                </FormAlert>
              )}
              <ReasonField
                id="dispose-reason"
                label="What happened"
                min={5}
                error={fieldError("reason")}
              />
            </>
          )}
        </FormDialog>
      )}
      {open === "remove" && (
        <FormDialog
          title={`Remove ${a.name}?`}
          description="Only for an asset entered by mistake. Its purchase and depreciation entries are reversed (both stay in the books), and money paid for it goes back into the account it came from."
          submitLabel="Remove it"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove it"
          onClose={close}
          onSubmit={async (form) => {
            const reason = readReason(form, 5);
            if (typeof reason !== "string") return reason;
            const result = await voidFixedAssetAction(a.id, { reason });
            if (!result.ok) return result.error;
            router.push(`${assetHref.register}?removed=${encodeURIComponent(a.name)}`);
          }}
        >
          {(fieldError) => <ReasonField id="remove-reason" min={5} error={fieldError("reason")} />}
        </FormDialog>
      )}
    </div>
  );
}
