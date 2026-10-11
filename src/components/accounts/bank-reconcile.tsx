"use client";

import { CalendarCheckIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount } from "@/components/products/form-values";
import { FormDialog } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay } from "@/lib/display";
import type { ReconcileScreen } from "@/modules/accounts/bank-reconcile.service";
import {
  setBankLinesClearedAction,
  tickBankLinesUpToAction,
} from "@/server/actions/accounts.actions";

import { accountsHref, columnAmount } from "./labels";
import { useNotice } from "./money-actions";
import { Amount } from "./privacy";

/** Paisa from "-12500.50". */
const toPaisa = (fixed: string) => Math.round(Number(fixed) * 100);

/**
 * The balance on the bank's own statement, typed in and compared with the
 * cleared balance. Nothing is saved: it is a check while ticking.
 */
export function StatementCompare({ cleared, currency }: { cleared: string; currency: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const negative = /^\s*[-−]/.test(text);
  const read = readAmount(text.replace(/^\s*[-−]\s*/, ""));
  let result: React.ReactNode = null;
  if (read === "invalid") {
    result = <FormAlert>{AMOUNT_HINT}</FormAlert>;
  } else if (read !== null) {
    const difference = Math.round(read * 100) * (negative ? -1 : 1) - toPaisa(cleared);
    const gap = (Math.abs(difference) / 100).toFixed(2);
    result =
      difference === 0 ? (
        <FormAlert tone="success">
          It matches the cleared balance: the books agree with the bank.
        </FormAlert>
      ) : (
        <FormAlert tone="note">
          The bank shows <Amount>{money(gap, currency)}</Amount> {difference > 0 ? "more" : "less"}{" "}
          than the cleared balance. Look for a line on the bank&apos;s statement that is not in the
          books yet (a bank charge, interest), or a line ticked by mistake.
        </FormAlert>
      );
  }
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <Field
        id={id}
        label="Balance on the bank's statement"
        hint="Type the closing balance printed on the statement to compare. It is not saved."
        className="max-w-sm"
      >
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder={`${currency} 0.00`}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      {result}
    </div>
  );
}

type Line = ReconcileScreen["lines"][number];

/**
 * The lines to tick. A tick saves at once and the line stays where it is, so a
 * mistake can be unticked straight away; the figures above refresh from the
 * server. Without accounts.manage the ticks are shown but cannot change.
 */
export function ReconcileChecklist({
  screen,
  currency,
}: {
  screen: ReconcileScreen;
  currency: string;
}) {
  const [lines, setLines] = useState(screen.lines);
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string>();
  const [upTo, setUpTo] = useState(false);
  const [notice, setNotice] = useNotice();
  const { bank, can, show } = screen;

  const mark = (ids: string[], cleared: boolean) =>
    setLines((before) => before.map((l) => (ids.includes(l.id) ? { ...l, cleared } : l)));
  const busy = (ids: string[], on: boolean) =>
    setSaving((before) => {
      const next = new Set(before);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function tick(line: Line, cleared: boolean) {
    setError(undefined);
    mark([line.id], cleared);
    busy([line.id], true);
    const result = await setBankLinesClearedAction(bank.id, { lineIds: [line.id], cleared });
    busy([line.id], false);
    if (!result.ok) {
      mark([line.id], !cleared);
      setError(result.error.message);
    }
  }

  const box = (l: Line) => (
    <Checkbox
      checked={l.cleared}
      disabled={!can.tick || saving.has(l.id)}
      onCheckedChange={(value) => tick(l, value === true)}
      aria-label={`${l.number} on ${formatDay(l.day)} cleared by the bank`}
      className="size-5 sm:size-4"
    />
  );
  const tickedBy = (l: Line) =>
    l.cleared && l.clearedOn
      ? `Ticked${l.clearedBy ? ` by ${l.clearedBy}` : ""} on ${formatDay(l.clearedOn)}`
      : null;
  const entryLink = (l: Line) => (
    <Link
      href={accountsHref.entry(l.entryId)}
      className="whitespace-nowrap text-primary underline-offset-4 hover:underline"
    >
      {l.number}
    </Link>
  );

  return (
    <div className="grid gap-4">
      {can.tick && show === "open" && lines.length > 0 && (
        <div>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setUpTo(true)}
          >
            <CalendarCheckIcon aria-hidden />
            Tick everything up to a day
          </Button>
        </div>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}

      {lines.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {show === "open"
            ? "Every line is ticked: nothing is waiting to clear at the bank."
            : "Nothing is ticked yet. Tick the lines that are also on the bank's statement."}
        </p>
      ) : (
        <>
          <ul className="grid divide-y rounded-lg border bg-card md:hidden" aria-label="Lines">
            {lines.map((l) => (
              <li key={l.id} className="flex items-start gap-3 p-4">
                <div className="pt-0.5">{box(l)}</div>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {formatDay(l.day)} · {entryLink(l)}
                    </span>
                    <span className="font-medium whitespace-nowrap tabular-nums">
                      {/[1-9]/.test(l.deposit) ? "In " : "Out "}
                      <Amount>
                        {columnAmount(l.deposit, currency) || columnAmount(l.withdrawal, currency)}
                      </Amount>
                    </span>
                  </div>
                  <p className="text-sm break-words">{l.details}</p>
                  {(l.note || tickedBy(l)) && (
                    <p className="text-[0.8125rem] break-words text-muted-foreground">
                      {[l.note, tickedBy(l)].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden rounded-lg border bg-card md:block">
            <Table aria-label="Lines">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 pl-4">
                    <span className="sr-only">Cleared</span>
                  </TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Deposit</TableHead>
                  <TableHead className="pr-4 text-right">Withdrawal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id} data-state={l.cleared ? "selected" : undefined}>
                    <TableCell className="pl-4">{box(l)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDay(l.day)}</TableCell>
                    <TableCell className="whitespace-nowrap">{entryLink(l)}</TableCell>
                    <TableCell className="min-w-56 whitespace-normal">
                      <span className="break-words">{l.details}</span>
                      {(l.note || tickedBy(l)) && (
                        <span className="block text-[0.8125rem] break-words text-muted-foreground">
                          {[l.note, tickedBy(l)].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {columnAmount(l.deposit, currency) && (
                        <Amount>{columnAmount(l.deposit, currency)}</Amount>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right whitespace-nowrap tabular-nums">
                      {columnAmount(l.withdrawal, currency) && (
                        <Amount>{columnAmount(l.withdrawal, currency)}</Amount>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {screen.hiddenCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {formatCount(screen.hiddenCount, currency)} more{" "}
          {screen.hiddenCount === 1 ? "line is" : "lines are"} not shown.{" "}
          {show === "open"
            ? "Tick the older ones in one go with “Tick everything up to a day”, and the rest come into view."
            : "The latest ticked lines are shown."}
        </p>
      )}

      {upTo && (
        <FormDialog
          title="Tick everything up to a day"
          description="For starting out: every line dated on or before the day you choose is ticked as cleared. Use the day of the last bank statement you have checked."
          submitLabel="Tick them"
          pendingLabel="Ticking"
          errorTitle="We could not tick the lines"
          onClose={() => setUpTo(false)}
          onSubmit={async (form) => {
            const day = String(form.get("upTo") ?? "");
            const result = await tickBankLinesUpToAction(bank.id, { upTo: day });
            if (!result.ok) return result.error;
            setLines((before) =>
              before.map((l) => (l.day <= day && !l.cleared ? { ...l, cleared: true } : l)),
            );
            setNotice(
              result.data.changed === 0
                ? `Nothing on or before ${formatDay(day)} was waiting.`
                : `${formatCount(result.data.changed, currency)} ${
                    result.data.changed === 1 ? "line" : "lines"
                  } up to ${formatDay(day)} ticked as cleared.`,
            );
            setUpTo(false);
          }}
        >
          {(fieldError) => (
            <Field id="reconcile-up-to" label="Up to and including" error={fieldError("upTo")}>
              <Input
                id="reconcile-up-to"
                name="upTo"
                type="date"
                required
                max={screen.today}
                defaultValue={screen.today}
              />
            </Field>
          )}
        </FormDialog>
      )}
    </div>
  );
}
