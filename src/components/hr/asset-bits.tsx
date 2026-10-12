"use client";

import { PackagePlusIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { AMOUNT_HINT, readAmount, textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import type { AssetView } from "@/modules/hr/asset.service";
import {
  issueAssetAction,
  removeAssetAction,
  returnAssetAction,
  undoAssetReturnAction,
} from "@/server/actions/hr.actions";

import { FlagBadge } from "./badges";
import { ASSET_KIND_WORDS, ASSET_KINDS, ASSET_RETURN_WORDS, ASSET_RETURNS } from "./asset-labels";
import { hrHref } from "./labels";
import { useNotice } from "./use-notice";

const smallText = "text-[0.8125rem] text-muted-foreground";
const linkClass = "text-primary underline-offset-4 hover:underline";

/** "Laptop (LT-0042)". */
const itemText = (a: { name: string; tag: string | null }) =>
  a.tag ? `${a.name} (${a.tag})` : a.name;

function StateBadge({ item }: { item: AssetView }) {
  if (item.out) return <FlagBadge tone="open">With them</FlagBadge>;
  const condition = item.returnCondition ?? "GOOD";
  return (
    <FlagBadge tone={condition === "GOOD" ? "done" : "warn"}>
      {ASSET_RETURN_WORDS[condition]}
    </FlagBadge>
  );
}

type Person = { id: string; code: string; name: string };

/**
 * "Give an item" (hr.manage): what it is, its kind, tag or serial, value and the
 * day it was handed over; to the person on the page, or to someone picked.
 */
export function GiveItemButton({
  employee,
  people = [],
  today,
  className,
}: {
  employee?: Person;
  people?: readonly Person[];
  today: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useNotice();
  if (!employee && people.length === 0) return null;
  return (
    <div className={className}>
      <Button
        type="button"
        variant={employee ? "outline" : "default"}
        size={employee ? "sm" : "default"}
        className={employee ? undefined : "w-full sm:w-auto"}
        onClick={() => setOpen(true)}
      >
        <PackagePlusIcon aria-hidden />
        Give an item
      </Button>
      {notice && (
        <div className="mt-3">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      )}
      {open && (
        <FormDialog
          title={employee ? `Give ${employee.name} a company item` : "Give a company item"}
          description="Record what was handed over. It shows in their My details, and it has to come back (or be marked lost) before they can be deactivated."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the item"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const employeeId = employee?.id ?? textOf(form, "employeeId");
            const name = textOf(form, "name");
            const issuedOn = textOf(form, "issuedOn");
            const value = readAmount(textOf(form, "value"));
            const errors: Record<string, string> = {};
            if (!employeeId) errors.employeeId = "Pick who has it.";
            if (name.length < 2) errors.name = "Write what it is.";
            if (!issuedOn) errors.issuedOn = "Pick the day it was handed over.";
            if (value === "invalid") errors.value = AMOUNT_HINT;
            if (Object.keys(errors).length > 0) return problem(errors);
            const result = await issueAssetAction({
              employeeId,
              name,
              kind: textOf(form, "kind") || "OTHER",
              tag: textOf(form, "tag") || null,
              value: typeof value === "number" ? value : null,
              issuedOn,
              note: textOf(form, "note") || null,
            });
            if (!result.ok) return result.error;
            setNotice(`${result.data.name} is recorded with ${result.data.employee.name}.`);
            setOpen(false);
          }}
        >
          {(fieldError) => (
            <>
              {!employee && (
                <Field id="item-employee" label="Given to" error={fieldError("employeeId")}>
                  <NativeSelect
                    id="item-employee"
                    name="employeeId"
                    defaultValue=""
                    containerClassName="sm:w-full"
                    aria-invalid={Boolean(fieldError("employeeId"))}
                  >
                    <option value="" disabled>
                      Pick someone
                    </option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.code}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
              <div className="grid items-start gap-5 sm:grid-cols-2">
                <Field id="item-name" label="What it is" error={fieldError("name")}>
                  <Input
                    id="item-name"
                    name="name"
                    maxLength={120}
                    placeholder="Dell laptop"
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("name"))}
                  />
                </Field>
                <Field id="item-kind" label="Kind" error={fieldError("kind")}>
                  <NativeSelect
                    id="item-kind"
                    name="kind"
                    defaultValue="LAPTOP"
                    containerClassName="sm:w-full"
                  >
                    {ASSET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ASSET_KIND_WORDS[k]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  id="item-tag"
                  label="Tag or serial (optional)"
                  hint="Asset tag, serial, SIM or phone number"
                  error={fieldError("tag")}
                >
                  <Input id="item-tag" name="tag" maxLength={80} autoComplete="off" />
                </Field>
                <Field id="item-value" label="Value (optional)" error={fieldError("value")}>
                  <Input
                    id="item-value"
                    name="value"
                    inputMode="decimal"
                    placeholder="0.00"
                    autoComplete="off"
                    aria-invalid={Boolean(fieldError("value"))}
                  />
                </Field>
                <Field id="item-on" label="Handed over on" error={fieldError("issuedOn")}>
                  <Input
                    id="item-on"
                    name="issuedOn"
                    type="date"
                    defaultValue={today}
                    max={today}
                    aria-invalid={Boolean(fieldError("issuedOn"))}
                  />
                </Field>
              </div>
              <Field id="item-note" label="Note (optional)" error={fieldError("note")}>
                <Textarea id="item-note" name="note" rows={2} maxLength={300} />
              </Field>
            </>
          )}
        </FormDialog>
      )}
    </div>
  );
}

/** One item's row actions (hr.manage): it came back, undo that, or remove a mistake. */
function ItemActions({ item, today }: { item: AssetView; today: string }) {
  const [open, setOpen] = useState<"return" | "remove" | null>(null);
  const [condition, setCondition] = useState<(typeof ASSET_RETURNS)[number]>("GOOD");
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const close = () => setOpen(null);
  const text = itemText(item);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {item.out ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen("return")}
            aria-label={`Take back ${text}`}
          >
            Take back
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={`Undo: ${text} is not back`}
            onClick={() =>
              startTransition(async () => {
                const result = await undoAssetReturnAction(item.id);
                if (!result.ok) setError(result.error);
              })
            }
          >
            Undo
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setOpen("remove")}
          aria-label={`Remove ${text}`}
        >
          Remove
        </Button>
      </div>

      {open === "return" && (
        <FormDialog
          title={`Take back ${text}`}
          description={`${item.employee.name} has had it since ${formatDay(item.issuedOn)}.`}
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not take the item back"
          onClose={close}
          onSubmit={async (form) => {
            const returnedOn = textOf(form, "returnedOn");
            const note = textOf(form, "note");
            const errors: Record<string, string> = {};
            if (!returnedOn) errors.returnedOn = "Pick the day it came back.";
            if (condition !== "GOOD" && note.length < 3) errors.note = "Say what happened.";
            if (Object.keys(errors).length > 0) return problem(errors);
            const result = await returnAssetAction(item.id, {
              returnedOn,
              condition,
              note: note || null,
            });
            if (!result.ok) return result.error;
            close();
          }}
        >
          {(fieldError) => (
            <>
              <ChoiceList
                name="condition"
                legend="How it came back"
                defaultValue={condition}
                onChange={setCondition}
                options={ASSET_RETURNS.map((c) => ({ value: c, label: ASSET_RETURN_WORDS[c] }))}
              />
              <Field
                id={`back-on-${item.id}`}
                label={condition === "LOST" ? "Found lost on" : "Back on"}
                error={fieldError("returnedOn")}
              >
                <Input
                  id={`back-on-${item.id}`}
                  name="returnedOn"
                  type="date"
                  defaultValue={today}
                  min={item.issuedOn}
                  max={today}
                  aria-invalid={Boolean(fieldError("returnedOn"))}
                />
              </Field>
              <Field
                id={`back-note-${item.id}`}
                label={condition === "GOOD" ? "Note (optional)" : "What happened"}
                error={fieldError("note")}
              >
                <Textarea
                  id={`back-note-${item.id}`}
                  name="note"
                  rows={2}
                  maxLength={300}
                  aria-invalid={Boolean(fieldError("note"))}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open === "remove" && (
        <FormDialog
          title={`Remove ${text}?`}
          description="Only for an item recorded by mistake, one that was never really given. To record it coming back, use “Take back”."
          submitLabel="Remove"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the item"
          onClose={close}
          onSubmit={async () => {
            const result = await removeAssetAction(item.id);
            if (!result.ok) return result.error;
            close();
          }}
        >
          {() => null}
        </FormDialog>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not change the item"
        onClose={() => setError(undefined)}
      />
    </>
  );
}

/**
 * Company items as cards: what it is, its tag, who has it (on HR's list), when
 * it was given and how it came back, with HR's actions.
 */
export function ItemList({
  items,
  today,
  manage,
  showEmployee = false,
  currency,
  empty,
}: {
  items: readonly AssetView[];
  today: string;
  manage: boolean;
  showEmployee?: boolean;
  currency: string;
  empty: string;
}) {
  if (items.length === 0) return <p className={`mt-3 ${smallText}`}>{empty}</p>;
  return (
    <ul
      className={
        showEmployee ? "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" : "mt-3 grid divide-y"
      }
      aria-label="Company items"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className={
            showEmployee
              ? "grid min-w-0 content-start gap-2 rounded-lg border bg-card p-4"
              : "grid gap-2 py-3 first:pt-0 last:pb-0"
          }
        >
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-medium break-words">{itemText(item)}</span>
              <span className={`block ${smallText}`}>
                {ASSET_KIND_WORDS[item.kind]}
                {item.value ? ` · ${money(item.value, currency)}` : ""}
              </span>
            </span>
            <StateBadge item={item} />
          </div>
          {showEmployee && (
            <p className="text-sm">
              <Link href={hrHref.employee(item.employee.id)} className={linkClass}>
                {item.employee.name}
              </Link>{" "}
              <span className="text-muted-foreground">· {item.employee.code}</span>
              {item.out && item.employee.exitDate && item.employee.exitDate < today && (
                <span className="text-destructive">
                  {" "}
                  · Left {formatDay(item.employee.exitDate)}
                </span>
              )}
            </p>
          )}
          <p className={smallText}>
            Given {formatDay(item.issuedOn)}
            {item.issuedBy ? ` by ${item.issuedBy}` : ""}
            {item.returnedOn
              ? ` · ${item.returnCondition === "LOST" ? "lost" : "back"} ${formatDay(item.returnedOn)}${
                  item.returnedTo ? ` (${item.returnedTo})` : ""
                }`
              : ""}
          </p>
          {(item.issueNote || item.returnNote) && (
            <p className={`${smallText} break-words`}>
              {[item.issueNote, item.returnNote].filter(Boolean).join(" · ")}
            </p>
          )}
          {manage && <ItemActions item={item} today={today} />}
        </li>
      ))}
    </ul>
  );
}

/** My details: the company items the employee holds now, and what they gave back. */
export function MyItems({ items }: { items: { out: AssetView[]; back: AssetView[] } }) {
  if (items.out.length === 0 && items.back.length === 0) {
    return <p className={`mt-3 ${smallText}`}>You hold no company items.</p>;
  }
  return (
    <div className="mt-3 grid gap-3">
      {items.out.length === 0 ? (
        <p className={smallText}>You hold no company items now.</p>
      ) : (
        <ul className="grid divide-y" aria-label="Items with me">
          {items.out.map((i) => (
            <li key={i.id} className="py-2 first:pt-0 last:pb-0">
              <span className="block text-sm font-medium break-words">{itemText(i)}</span>
              <span className={`block ${smallText}`}>
                {ASSET_KIND_WORDS[i.kind]} · since {formatDay(i.issuedOn)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.back.length > 0 && (
        <p className={`border-t pt-3 ${smallText}`}>
          Given back:{" "}
          {items.back
            .map(
              (i) =>
                `${itemText(i)} (${i.returnCondition === "LOST" ? "lost" : "back"} ${formatDay(i.returnedOn!)})`,
            )
            .join(", ")}
        </p>
      )}
      {items.out.length > 0 && <p className={smallText}>Give them back to HR when you leave.</p>}
    </div>
  );
}
