"use client";

import { LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionError } from "@/lib/result";
import type { getFreshStart } from "@/modules/fresh-start/fresh-start.service";
import { getFreshStartAction, startFreshStartAction } from "@/server/actions/fresh-start.actions";

type State = Awaited<ReturnType<typeof getFreshStart>>;

/** While a fresh start runs, the card asks again this often. */
const POLL_MS = 5000;

const TICKS = [
  {
    name: "keepParties",
    label: "Keep buyers and suppliers",
    hint: "Their names and details stay; their balances start at zero.",
  },
  {
    name: "keepProducts",
    label: "Keep products and styles",
    hint: "Styles, colours and sizes, shop prices, size charts and the materials list stay; stock starts at zero.",
  },
  {
    name: "keepEmployees",
    label: "Keep employees",
    hint: "Their details, papers, salary and leave days stay; attendance, payroll and advances go.",
  },
] as const;

function kept(record: NonNullable<State["record"]>) {
  const list = [
    record.keepParties && "buyers and suppliers",
    record.keepProducts && "products and styles",
    record.keepEmployees && "employees",
  ].filter(Boolean);
  return list.length
    ? `Kept besides the settings: ${list.join(", ")}.`
    : "Only the settings were kept.";
}

/**
 * Settings > Company, for the owner only: the one fresh start of the company's
 * life. It erases the business data after a backup that is checked in Google
 * Drive and kept for ever; once used, the card says when and by whom, and the
 * button is gone for good.
 */
export function FreshStartCard({ initial }: { initial: State }) {
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const record = state.record;
  const running = record?.status === "BACKING_UP" || record?.status === "ERASING";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const next = await getFreshStartAction();
      if (next.ok) setState(next.data);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  function submit(form: FormData) {
    setError(undefined);
    startTransition(async () => {
      const result = await startFreshStartAction({
        keepParties: form.get("keepParties") === "on",
        keepProducts: form.get("keepProducts") === "on",
        keepEmployees: form.get("keepEmployees") === "on",
        companyName: String(form.get("companyName") ?? ""),
        pin: String(form.get("pin") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      const next = await getFreshStartAction();
      if (next.ok) setState(next.data);
    });
  }

  return (
    <section aria-labelledby="fresh-start-title" className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4 sm:px-6">
        <h3 id="fresh-start-title" className="font-serif text-xl text-primary">
          Fresh start
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Erase the practice data once, when you start real work. It can be used only once in the
          life of this company.
        </p>
      </div>
      <div className="grid gap-4 px-5 py-5 text-sm sm:px-6">
        {record?.status === "DONE" ? (
          <FormAlert tone="note">
            <p>
              Fresh start was used on {record.day} by {record.startedByName}.
            </p>
            <p className="mt-1 text-muted-foreground">
              {kept(record)} The backup made just before it ({record.backupName}) is kept for ever.
            </p>
          </FormAlert>
        ) : running ? (
          <FormAlert tone="note">
            <span className="flex items-start gap-2">
              <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
              <span aria-live="polite">
                {record?.status === "BACKING_UP"
                  ? "Making a full backup and checking it in Google Drive. This can take some minutes; nothing is erased yet."
                  : "Erasing the business data. This page updates by itself."}
              </span>
            </span>
          </FormAlert>
        ) : (
          <>
            {record?.status === "FAILED" && (
              <FormAlert>The last try stopped: {record.error}</FormAlert>
            )}
            {state.notReady && <FormAlert tone="note">{state.notReady}</FormAlert>}
            <div>
              <Button
                type="button"
                variant="destructive"
                disabled={!state.canUse || Boolean(state.notReady)}
                onClick={() => {
                  setError(undefined);
                  setOpen(true);
                }}
              >
                <RotateCcwIcon aria-hidden />
                Start fresh
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Start fresh</DialogTitle>
            <DialogDescription>
              This erases the business data of {state.companyName} for good. It can be done only
              once.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-4 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              submit(new FormData(event.currentTarget));
            }}
          >
            <div className="grid gap-1">
              <p className="font-medium">What is erased</p>
              <p className="text-muted-foreground">
                Orders, quotations, proformas, invoices, money received and paid, journal entries,
                stock and its movements, purchase orders, bills, bookings, tech packs, production
                and CM, shop orders and returns, attendance, payroll, leave and advances, loans and
                fixed costs, assets, reminders, notes and the planner, the inbox, AI drafts, Bug
                Guard findings, the activity log and uploaded files. Every balance starts at zero.
                Your online shops are told their stock is now zero, and erased products are taken
                off them.
              </p>
            </div>
            <div className="grid gap-1">
              <p className="font-medium">What is kept</p>
              <p className="text-muted-foreground">
                The company&apos;s details and logo, the team, roles and permissions, your PIN,
                backups and Google Drive, shop connections and their keys, the retail stores and
                their buyers, the Walk-in customer, the chart of accounts, bank accounts, petty cash
                boxes, expense heads, warehouses, categories, brands, colours, sizes, terms,
                document templates, reminder rules, HR settings, holidays and leave types, the AI
                Center and the Telegram bot, Bug Guard&apos;s settings and every other setting.
              </p>
            </div>
            <fieldset className="grid gap-3">
              <legend className="mb-1 font-medium">Also keep</legend>
              {TICKS.map((tick) => (
                <label key={tick.name} className="flex items-start gap-2.5">
                  <Checkbox name={tick.name} className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span>{tick.label}</span>
                    <span className="text-muted-foreground">{tick.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <FormAlert tone="note">
              First a full backup is made and checked in Google Drive; it is kept for ever. If it
              cannot be made, nothing is erased. Until it finishes nobody can change this
              company&apos;s data. Restoring a backup from before the fresh start brings the old
              data back, and this button with it.
            </FormAlert>
            <Field
              id="fresh-start-name"
              label="Type the company name to confirm"
              hint={state.companyName}
              error={error?.fieldErrors?.companyName?.[0]}
            >
              <Input id="fresh-start-name" name="companyName" autoComplete="off" />
            </Field>
            <PinField
              id="fresh-start-pin"
              error={error?.fieldErrors?.pin?.[0] ?? error?.fieldErrors?.["pinNotSet"]?.[0]}
            />
            {error && error.code !== "INTERNAL" && !error.fieldErrors && (
              <FormAlert>{error.message}</FormAlert>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
                Erase and start fresh
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="The fresh start could not start"
          onClose={() => setError(undefined)}
        />
      )}
    </section>
  );
}
