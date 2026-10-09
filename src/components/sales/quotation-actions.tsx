"use client";

import {
  CheckIcon,
  EllipsisVerticalIcon,
  FileOutputIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { QuotationMark } from "@/modules/sales/rules";
import type { QuotationScreen } from "@/modules/sales/screens.service";
import {
  convertQuotationToProformaAction,
  deleteQuotationAction,
  setQuotationStatusAction,
} from "@/server/actions/sales.actions";

import { FormDialog, problem } from "./dialogs";
import { money, salesHref } from "./labels";

type Open = QuotationMark | "convert" | "delete" | null;

const MARKS: Record<QuotationMark, { label: string; icon: typeof SendIcon; done: string }> = {
  SENT: { label: "Mark as sent", icon: SendIcon, done: "Marked as sent to the buyer." },
  ACCEPTED: { label: "Mark as accepted", icon: CheckIcon, done: "Marked as accepted." },
  REJECTED: { label: "Mark as rejected", icon: XIcon, done: "Marked as rejected." },
};

/**
 * What can be done with a quotation, each offered from the flags the screen
 * came with (screen.can, from sales/rules.ts): sales.quotation.manage edits a
 * draft or sent one, marks it sent, accepted or rejected, deletes a draft and
 * makes the proforma invoice. Everyone who sees it can print it.
 */
export function QuotationActions({
  screen,
  notice: initialNotice,
}: {
  screen: QuotationScreen;
  notice?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState(initialNotice);
  const { quotation: q, can } = screen;
  const close = () => setOpen(null);
  const hasMenu = can.marks.length > 0 || can.delete;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can.convert && (
          <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen("convert")}>
            <FileOutputIcon aria-hidden />
            Make a proforma invoice
          </Button>
        )}
        <div className="flex gap-2">
          {can.edit && (
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href={`${salesHref.quotation(q.id)}/edit`}>
                <PencilIcon aria-hidden />
                Edit
              </Link>
            </Button>
          )}
          <PrintDocumentButton
            request={{ type: "QUOTATION", id: q.id }}
            label="PDF"
            className="flex-1 sm:flex-none"
            ready={{
              eyebrow: "Quotation",
              description: `${q.number} for ${q.buyer.name}, on the company letterhead.`,
              errorTitle: "We could not make the quotation PDF",
            }}
          />
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={`More for ${q.number}`}>
                  <EllipsisVerticalIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {can.marks.map((mark) => {
                  const { label, icon: Icon } = MARKS[mark];
                  return (
                    <DropdownMenuItem key={mark} onSelect={() => setOpen(mark)}>
                      <Icon aria-hidden />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
                {can.delete && (
                  <>
                    {can.marks.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
                      <Trash2Icon aria-hidden />
                      Delete the draft
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {(open === "SENT" || open === "ACCEPTED" || open === "REJECTED") && (
        <ConfirmDialog
          title={`${MARKS[open].label.replace("Mark", "Mark " + q.number)}?`}
          description={
            open === "SENT"
              ? "It shows as sent to the buyer, waiting for their answer. It can still be edited."
              : open === "ACCEPTED"
                ? "The buyer agreed. Next, make the proforma invoice to ask for the advance."
                : "The buyer said no. It stays on record and can no longer be changed."
          }
          confirmLabel={MARKS[open].label}
          pendingLabel="Saving"
          destructive={open === "REJECTED"}
          errorTitle="We could not change the quotation"
          onClose={close}
          onConfirm={async () => {
            const result = await setQuotationStatusAction(q.id, { status: open });
            if (!result.ok) return result.error;
            setNotice(MARKS[open].done);
            close();
          }}
        />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title={`Delete draft ${q.number}?`}
          description="It was never sent, so it is removed for good. Its number is not used again."
          confirmLabel="Delete the draft"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the quotation"
          onClose={close}
          onConfirm={async () => {
            const result = await deleteQuotationAction(q.id);
            if (!result.ok) return result.error;
            router.push("/sales/quotations");
          }}
        />
      )}
      {open === "convert" && (
        <FormDialog
          title={`Make a proforma invoice from ${q.number}?`}
          description={`It asks ${q.buyer.name} for an advance on the ${money(q.total, q.currency)} total. Once the advance is paid in full, production starts.`}
          submitLabel="Make the proforma"
          pendingLabel="Making it"
          errorTitle="We could not make the proforma invoice"
          onClose={close}
          onSubmit={async (form) => {
            const percent = Number(textOf(form, "advancePercent"));
            if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
              return problem({ advancePercent: "Enter a percentage from 0 to 100." });
            }
            const result = await convertQuotationToProformaAction(q.id, {
              advancePercent: percent,
            });
            if (!result.ok) return result.error;
            router.push(`${salesHref.proforma(result.data.id)}?created=1`);
          }}
        >
          {(fieldError) => (
            <Field
              id="advance-percent"
              label="Advance (%)"
              hint={`The company's usual advance is ${screen.advancePercent}%.`}
              error={fieldError("advancePercent")}
            >
              <Input
                id="advance-percent"
                name="advancePercent"
                inputMode="decimal"
                defaultValue={String(screen.advancePercent)}
                autoComplete="off"
                className="sm:w-32"
                aria-describedby={
                  fieldError("advancePercent") ? "advance-percent-error" : "advance-percent-hint"
                }
              />
            </Field>
          )}
        </FormDialog>
      )}
    </div>
  );
}
