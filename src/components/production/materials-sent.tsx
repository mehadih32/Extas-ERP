"use client";

import { Ban, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { PrintDocumentButton } from "@/components/documents/print-button";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog, problem, readReason, ReasonField } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ProjectScreen } from "@/modules/production/screens.service";
import {
  cancelMaterialChallanAction,
  createMaterialChallanAction,
} from "@/server/actions/production.actions";

import { dayOrNow } from "./cost-dialogs";
import { materialLine } from "./labels";

type Challan = ProjectScreen["materialsSent"]["challans"][number];
type Line = { key: number; description: string; quantity: string; unit: string };

const MAX_LINES = 30;
/** Units offered as you type; any other word works too. */
const UNITS = ["kg", "m", "yd", "pcs", "rolls", "cones", "dozen", "gross", "sets", "cartons"];

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, description: "", quantity: "", unit: "" });

/** A line's quantity: above zero with up to 3 decimals, or what is wrong with it. */
function readLineQuantity(text: string): number | string {
  const value = text.trim().replace(/,/g, "");
  if (!value) return "Enter the quantity.";
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return "Enter a number like 500 or 12.5.";
  const n = Number(value);
  if (n <= 0) return "Enter more than zero.";
  if (n > 100_000_000) return "That is too much for one line.";
  return n;
}

/** The lines as the server takes them, or the problems found per line. */
function readLines(lines: Line[]) {
  const errors: Record<string, string> = {};
  const items: Array<{ description: string; quantity: number; unit: string }> = [];
  lines.forEach((line, i) => {
    const description = line.description.trim();
    const unit = line.unit.trim();
    const quantity = readLineQuantity(line.quantity);
    if (description.length < 2) errors[`items.${i}.description`] = "Write what was sent.";
    if (typeof quantity === "string") errors[`items.${i}.quantity`] = quantity;
    if (!unit) errors[`items.${i}.unit`] = "Enter the unit.";
    if (typeof quantity === "number") items.push({ description, quantity, unit });
  });
  return Object.keys(errors).length > 0 ? problem(errors) : items;
}

/**
 * "Send material": what went to the factory (fabric, trims, cartons...) as
 * written, line by line, with where it went and how. Saved under the next
 * MC- number with a Material Challan to print; stock and costs stay as they are.
 */
function SendMaterialDialog({
  project,
  defaultSentTo,
  today,
  currency,
  onDone,
  onClose,
}: {
  project: { id: string; code: string };
  defaultSentTo: string | null;
  today: string;
  currency: string;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
  const change = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <FormDialog
      title={`Send material for ${project.code}`}
      description="Write down what went to the factory, such as 500 kg Oxford fabric. It gets a challan number and a challan to print. Stock and costs do not change."
      submitLabel="Save the challan"
      pendingLabel="Saving"
      errorTitle="We could not save the challan"
      className="sm:max-w-2xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const items = readLines(lines);
        if (!Array.isArray(items)) return items;
        const sentTo = textOf(form, "sentTo");
        if (!sentTo && !defaultSentTo) {
          return problem({ sentTo: "Enter the factory or person it went to." });
        }
        const result = await createMaterialChallanAction(project.id, {
          sentOn: dayOrNow(form, "sentOn", today),
          sentTo: sentTo || undefined,
          items,
          carrier: textOf(form, "carrier") || undefined,
          notes: textOf(form, "notes") || undefined,
        });
        if (!result.ok) return result.error;
        onDone(
          `${result.data.number} was saved: ${items.map((i) => materialLine(i, currency)).join(", ")}.`,
        );
      }}
    >
      {(fieldError) => (
        <>
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field
              id="mc-sent-to"
              label="Sent to"
              hint={defaultSentTo ? "The project's factory unless you change it." : undefined}
              error={fieldError("sentTo")}
            >
              <Input
                id="mc-sent-to"
                name="sentTo"
                defaultValue={defaultSentTo ?? ""}
                maxLength={300}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("sentTo"))}
                aria-describedby={
                  fieldError("sentTo")
                    ? "mc-sent-to-error"
                    : defaultSentTo
                      ? "mc-sent-to-hint"
                      : undefined
                }
              />
            </Field>
            <Field id="mc-sent-on" label="Date" error={fieldError("sentOn")}>
              <Input id="mc-sent-on" name="sentOn" type="date" defaultValue={today} max={today} />
            </Field>
          </div>
          <fieldset className="grid min-w-0 gap-3">
            <legend className="mb-1 text-sm font-medium">What was sent</legend>
            <ul className="grid grid-cols-1 gap-3">
              {lines.map((line, index) => {
                const err = (field: string) => fieldError(`items.${index}.${field}`);
                const id = (field: string) => `mc-line-${line.key}-${field}`;
                return (
                  <li key={line.key} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[0.8125rem] font-medium text-muted-foreground">
                        Line {index + 1}
                      </p>
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                          aria-label={`Remove line ${index + 1}`}
                        >
                          <Trash2Icon aria-hidden />
                          Remove
                        </Button>
                      )}
                    </div>
                    <Field id={id("what")} label="Item" error={err("description")}>
                      <Input
                        id={id("what")}
                        value={line.description}
                        onChange={(e) => change(line.key, { description: e.target.value })}
                        placeholder="Oxford fabric, navy"
                        maxLength={200}
                        autoComplete="off"
                        aria-invalid={Boolean(err("description"))}
                        aria-describedby={err("description") ? `${id("what")}-error` : undefined}
                      />
                    </Field>
                    <div className="grid grid-cols-2 items-start gap-3">
                      <Field id={id("qty")} label="Quantity" error={err("quantity")}>
                        <Input
                          id={id("qty")}
                          value={line.quantity}
                          onChange={(e) => change(line.key, { quantity: e.target.value })}
                          inputMode="decimal"
                          placeholder="500"
                          autoComplete="off"
                          aria-invalid={Boolean(err("quantity"))}
                          aria-describedby={err("quantity") ? `${id("qty")}-error` : undefined}
                        />
                      </Field>
                      <Field id={id("unit")} label="Unit" error={err("unit")}>
                        <Input
                          id={id("unit")}
                          value={line.unit}
                          onChange={(e) => change(line.key, { unit: e.target.value })}
                          list="mc-units"
                          placeholder="kg"
                          maxLength={20}
                          autoComplete="off"
                          aria-invalid={Boolean(err("unit"))}
                          aria-describedby={err("unit") ? `${id("unit")}-error` : undefined}
                        />
                      </Field>
                    </div>
                  </li>
                );
              })}
            </ul>
            <datalist id="mc-units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {lines.length < MAX_LINES && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto sm:justify-self-start"
                onClick={() => setLines((all) => [...all, emptyLine()])}
              >
                <PlusIcon aria-hidden />
                Add a line
              </Button>
            )}
          </fieldset>
          <Field
            id="mc-carrier"
            label="Sent with (optional)"
            hint="Vehicle number, driver or courier."
          >
            <Input
              id="mc-carrier"
              name="carrier"
              maxLength={120}
              autoComplete="off"
              aria-describedby="mc-carrier-hint"
            />
          </Field>
          <Field id="mc-notes" label="Notes (optional)">
            <Textarea id="mc-notes" name="notes" rows={2} maxLength={1000} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Cancels a challan saved by mistake; it stays listed, marked cancelled. */
function CancelChallanDialog({
  challan,
  onDone,
  onClose,
}: {
  challan: Challan;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={`Cancel ${challan.number}?`}
      description="It stays on the list marked cancelled, and its challan prints stamped Cancelled."
      submitLabel="Cancel the challan"
      pendingLabel="Cancelling"
      destructive
      errorTitle="We could not cancel the challan"
      onClose={onClose}
      onSubmit={async (form) => {
        const reason = readReason(form, 5);
        if (typeof reason !== "string") return reason;
        const result = await cancelMaterialChallanAction(challan.id, { reason });
        if (!result.ok) return result.error;
        onDone(`${challan.number} was cancelled.`);
      }}
    >
      {(fieldError) => <ReasonField id="mc-cancel-reason" min={5} error={fieldError("reason")} />}
    </FormDialog>
  );
}

/**
 * "Materials sent" on a production project: each challan of what went to the
 * factory, newest first, with its PDF. Production Managers send and cancel;
 * everyone who sees the project sees the list and prints the challans.
 */
export function MaterialsSent({
  screen,
  currency,
}: {
  screen: Pick<ProjectScreen, "project" | "materialsSent" | "can">;
  currency: string;
}) {
  const { project, materialsSent, can } = screen;
  const [open, setOpen] = useState<"send" | Challan | null>(null);
  const [notice, setNotice] = useState<string>();
  const close = () => setOpen(null);
  const done = (message: string) => {
    setNotice(message);
    close();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const { challans } = materialsSent;
  return (
    <Panel title="Materials sent" id="materials-sent-heading">
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">
        What went to the factory, each on its own challan. A record only: stock and costs do not
        change.
      </p>
      {can.sendMaterial && (
        <Button
          type="button"
          size="sm"
          className="mt-4 w-full sm:w-auto"
          onClick={() => setOpen("send")}
        >
          <SendIcon aria-hidden />
          Send material
        </Button>
      )}
      {notice && (
        <div className="mt-4">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {challans.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 divide-y">
          {challans.map((c) => (
            <li
              key={c.id}
              className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">{c.number}</span>
                  {c.cancelled && <StatusBadge tone="closed">Cancelled</StatusBadge>}
                </p>
                <p className="mt-0.5 text-[0.8125rem] break-words text-muted-foreground">
                  {[formatDay(c.sentOn), `to ${c.sentTo}`, c.carrier, c.sentBy && `by ${c.sentBy}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p
                  className={`mt-1 text-sm break-words ${c.cancelled ? "text-muted-foreground line-through" : ""}`}
                >
                  {c.items.map((i) => materialLine(i, currency)).join(", ")}
                </p>
                {c.notes && (
                  <p className="mt-1 text-[0.8125rem] break-words text-muted-foreground">
                    {c.notes}
                  </p>
                )}
                {c.cancelled && (
                  <p className="mt-1 text-[0.8125rem] break-words text-muted-foreground">
                    Cancelled {formatDay(c.cancelled.on)}: {c.cancelled.reason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <PrintDocumentButton
                  request={{ type: "MATERIAL_CHALLAN", id: c.id }}
                  label="PDF"
                  className="w-auto"
                  ready={{
                    eyebrow: "Material challan",
                    description: `${c.number} for ${project.code}, to ${c.sentTo}.`,
                    errorTitle: "We could not make the challan PDF",
                  }}
                />
                {can.cancelChallan && !c.cancelled && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-auto"
                    onClick={() => setOpen(c)}
                    aria-label={`Cancel ${c.number}`}
                  >
                    <Ban aria-hidden />
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open === "send" && (
        <SendMaterialDialog
          project={project}
          defaultSentTo={materialsSent.sentTo}
          today={materialsSent.today}
          currency={currency}
          onDone={done}
          onClose={close}
        />
      )}
      {open && open !== "send" && (
        <CancelChallanDialog challan={open} onDone={done} onClose={close} />
      )}
    </Panel>
  );
}
