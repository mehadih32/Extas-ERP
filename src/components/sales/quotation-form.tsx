"use client";

import { LoaderCircleIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { QuotationForm as QuotationFormData } from "@/modules/sales/screens.service";
import { createQuotationAction, updateQuotationAction } from "@/server/actions/sales.actions";

import { money, salesHref } from "./labels";
import { BuyerPicker, StylePicker } from "./pickers";

type Buyer = { id: string; code: string; name: string };

type ItemDraft = {
  key: string;
  style: { id: string; code: string; name: string } | null;
  categoryId: string;
  description: string;
  fabric: string;
  colorNote: string;
  bySize: boolean;
  quantity: string;
  sizes: Record<string, string>;
  unitPrice: string;
};

type RuleDraft = { key: string; area: string; instruction: string };

// Rows added in the browser get keys from this counter; rows the page starts
// with are keyed by position, so the server and the browser agree on them.
let nextKey = 0;
const newKey = () => `row-${++nextKey}`;

const emptyItem = (key = newKey()): ItemDraft => ({
  key,
  style: null,
  categoryId: "",
  description: "",
  fabric: "",
  colorNote: "",
  bySize: false,
  quantity: "",
  sizes: {},
  unitPrice: "",
});

const wholeNumber = (text: string) => (/^\d{1,7}$/.test(text.trim()) ? Number(text) : null);

/** Pieces on an item: the quantity, or its sizes added up. */
function piecesOf(item: ItemDraft): number {
  if (!item.bySize) return wholeNumber(item.quantity) ?? 0;
  return Object.values(item.sizes).reduce((sum, q) => sum + (wholeNumber(q) ?? 0), 0);
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-5 border-t pt-6 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 font-serif text-lg text-primary">{title}</legend>
      <div className="clear-left grid min-w-0 gap-5">
        {hint && <p className="-mt-3 text-sm text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </fieldset>
  );
}

/**
 * The quotation builder (blueprint): the buyer, items by style or category with
 * fabric, colour and a quantity or a size breakdown at a price, free-text
 * styling rules, discount and tax, terms, and the company's custom fields. For
 * new quotations and for editing a draft or sent one; both need
 * sales.quotation.manage, as the quotation actions check.
 */
export function QuotationForm({ form: data }: { form: QuotationFormData }) {
  const router = useRouter();
  const editing = data.quotation;
  const currency = data.currency;
  const [buyer, setBuyer] = useState<Buyer | null>(editing?.buyer ?? null);
  const [items, setItems] = useState<ItemDraft[]>(() =>
    editing
      ? editing.items.map((i, index) => ({
          key: `item-${index}`,
          style: i.style,
          categoryId: i.category?.id ?? "",
          description: i.description,
          fabric: i.fabric ?? "",
          colorNote: i.colorNote ?? "",
          bySize: Boolean(i.sizes),
          quantity: i.sizes ? "" : String(i.quantity),
          sizes: Object.fromEntries((i.sizes ?? []).map((s) => [s.size, String(s.quantity)])),
          unitPrice: i.unitPrice,
        }))
      : [emptyItem("item-0")],
  );
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    (editing?.stylingRules ?? []).map((r, index) => ({
      key: `rule-${index}`,
      area: r.area ?? "",
      instruction: r.instruction,
    })),
  );
  const [discount, setDiscount] = useState(
    editing && Number(editing.discount) ? editing.discount : "",
  );
  const [tax, setTax] = useState(editing && Number(editing.tax) ? editing.tax : "");
  const [fields, setFields] = useState<Record<string, string | boolean>>(
    editing?.customFields ?? {},
  );
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const fieldError = (name: string) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors =
    Object.keys(problems).length > 0 || Object.keys(error?.fieldErrors ?? {}).length > 0;

  const update = (key: string, change: Partial<ItemDraft>) =>
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const lineTotal = (item: ItemDraft) => {
    const price = readAmount(item.unitPrice);
    return typeof price === "number" ? price * piecesOf(item) : 0;
  };
  const subtotal = items.reduce((sum, i) => sum + lineTotal(i), 0);
  const discountValue = readAmount(discount);
  const taxValue = readAmount(tax);
  const total =
    subtotal -
    (typeof discountValue === "number" ? discountValue : 0) +
    (typeof taxValue === "number" ? taxValue : 0);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    const found: Record<string, string> = {};
    if (!buyer) found.partyId = "Choose the buyer.";
    items.forEach((item, index) => {
      if (item.description.trim().length < 1) {
        found[`items.${index}.description`] = "Describe the item.";
      }
      if (piecesOf(item) < 1) {
        found[`items.${index}.quantity`] = item.bySize
          ? "Enter pieces for at least one size."
          : "Enter the number of pieces.";
      }
      const price = readAmount(item.unitPrice);
      if (price === "invalid" || price === null) {
        found[`items.${index}.unitPrice`] =
          price === null ? "Enter the price per piece." : AMOUNT_HINT;
      }
    });
    rules.forEach((rule, index) => {
      if (rule.instruction.trim() && rule.instruction.trim().length < 2) {
        found[`stylingRules.${index}.instruction`] = "Write at least 2 letters.";
      }
    });
    if (discountValue === "invalid") found.discount = AMOUNT_HINT;
    if (taxValue === "invalid") found.tax = AMOUNT_HINT;
    const issueDate = text("issueDate");
    const validUntil = text("validUntil");
    if (validUntil && issueDate && validUntil < issueDate) {
      found.validUntil = "Choose a day on or after the quotation's date.";
    }
    for (const def of data.customFields) {
      const value = fields[def.key];
      if (def.isRequired && (value === undefined || value === "")) {
        found[`customFields.${def.key}`] = "Required";
      }
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const input = {
      partyId: buyer!.id,
      issueDate: issueDate || undefined,
      validUntil: validUntil || null,
      items: items.map((item) => ({
        styleId: item.style?.id ?? null,
        categoryId: item.categoryId || null,
        description: item.description.trim(),
        fabric: item.fabric.trim() || null,
        colorNote: item.colorNote.trim() || null,
        ...(item.bySize
          ? {
              sizeBreakdown: Object.fromEntries(
                Object.entries(item.sizes)
                  .map(([size, q]) => [size, wholeNumber(q) ?? 0] as const)
                  .filter(([, q]) => q > 0),
              ),
            }
          : { quantity: wholeNumber(item.quantity)!, sizeBreakdown: null }),
        unitPrice: readAmount(item.unitPrice) as number,
      })),
      stylingRules: rules
        .filter((r) => r.instruction.trim())
        .map((r) => ({ area: r.area.trim() || null, instruction: r.instruction.trim() })),
      discount: (discountValue as number | null) ?? 0,
      tax: (taxValue as number | null) ?? 0,
      terms: text("terms") || null,
      notes: text("notes") || null,
      customFields: Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== "" && v !== false),
      ),
    };
    startTransition(async () => {
      const result = editing
        ? await updateQuotationAction(editing.id, input)
        : await createQuotationAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`${salesHref.quotation(result.data.id)}?${editing ? "saved" : "created"}=1`);
    });
  }

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-8" noValidate>
      <Section title="Buyer and dates">
        <Field id="quotation-buyer" label="Buyer" error={fieldError("partyId")}>
          <BuyerPicker
            id="quotation-buyer"
            value={buyer}
            onChange={setBuyer}
            currency={currency}
            invalid={Boolean(fieldError("partyId"))}
            describedBy={fieldError("partyId") ? "quotation-buyer-error" : undefined}
          />
        </Field>
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field id="issueDate" label="Date">
            <Input
              id="issueDate"
              name="issueDate"
              type="date"
              defaultValue={editing?.issuedOn ?? data.today}
            />
          </Field>
          <Field
            id="validUntil"
            label="Valid until (optional)"
            hint="Leave empty for no end date."
            error={fieldError("validUntil")}
          >
            <Input
              id="validUntil"
              name="validUntil"
              type="date"
              defaultValue={editing?.validUntil ?? ""}
              aria-describedby={fieldError("validUntil") ? "validUntil-error" : "validUntil-hint"}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Items"
        hint="Pick a style from the catalogue or describe a new one. Give the pieces in total or by size."
      >
        <ol className="grid grid-cols-1 gap-4">
          {items.map((item, index) => {
            const at = (name: string) => `items.${index}.${name}`;
            const id = (name: string) => `${item.key}-${name}`;
            return (
              <li
                key={item.key}
                className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="eyebrow">Item {index + 1}</p>
                  {items.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <Trash2Icon aria-hidden />
                      Remove
                    </Button>
                  )}
                </div>
                <div className="grid items-start gap-4 md:grid-cols-2">
                  <Field id={id("style")} label="Style (optional)">
                    {item.style ? (
                      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="truncate text-sm">
                          {item.style.code} · {item.style.name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => update(item.key, { style: null })}
                          aria-label={`Remove the style from item ${index + 1}`}
                        >
                          <XIcon aria-hidden />
                        </Button>
                      </div>
                    ) : (
                      <StylePicker
                        id={id("style")}
                        currency={currency}
                        onPick={(style) =>
                          update(item.key, {
                            style: { id: style.id, code: style.code, name: style.name },
                            description: item.description || style.name,
                            unitPrice: item.unitPrice || style.wholesalePrice,
                            categoryId: item.categoryId || style.categoryId,
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field id={id("category")} label="Category (optional)">
                    <NativeSelect
                      id={id("category")}
                      value={item.categoryId}
                      onChange={(e) => update(item.key, { categoryId: e.target.value })}
                      containerClassName="sm:w-full"
                    >
                      <option value="">No category</option>
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {" ".repeat(c.depth)}
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                <Field
                  id={id("description")}
                  label="Description"
                  error={fieldError(at("description"))}
                >
                  <Input
                    id={id("description")}
                    value={item.description}
                    maxLength={500}
                    onChange={(e) => update(item.key, { description: e.target.value })}
                    placeholder="Classic polo, pique knit"
                    aria-invalid={Boolean(fieldError(at("description")))}
                  />
                </Field>
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <Field id={id("fabric")} label="Fabric (optional)">
                    <Input
                      id={id("fabric")}
                      value={item.fabric}
                      maxLength={200}
                      onChange={(e) => update(item.key, { fabric: e.target.value })}
                      placeholder="100% cotton, 220 GSM"
                    />
                  </Field>
                  <Field id={id("color")} label="Colours (optional)">
                    <Input
                      id={id("color")}
                      value={item.colorNote}
                      maxLength={200}
                      onChange={(e) => update(item.key, { colorNote: e.target.value })}
                      placeholder="Navy, white"
                    />
                  </Field>
                </div>
                <div className="grid gap-3">
                  <div
                    role="group"
                    aria-label={`Pieces for item ${index + 1}`}
                    className="flex flex-wrap gap-2"
                  >
                    {(
                      [
                        [false, "Total pieces"],
                        [true, "By size"],
                      ] as const
                    ).map(([bySize, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={item.bySize === bySize}
                        onClick={() => update(item.key, { bySize })}
                        disabled={bySize && data.sizes.length === 0}
                        className={cn(
                          "h-9 cursor-pointer rounded-md border px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
                          item.bySize === bySize
                            ? "border-primary bg-secondary text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {item.bySize ? (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {data.sizes.map((size) => (
                          <label
                            key={size.id}
                            className="grid gap-1 text-[0.8125rem] text-muted-foreground"
                          >
                            {size.name}
                            <Input
                              inputMode="numeric"
                              value={item.sizes[size.name] ?? ""}
                              onChange={(e) =>
                                update(item.key, {
                                  sizes: { ...item.sizes, [size.name]: e.target.value },
                                })
                              }
                              placeholder="0"
                              aria-label={`Pieces in ${size.name}`}
                              className="text-right tabular-nums"
                            />
                          </label>
                        ))}
                      </div>
                      {fieldError(at("quantity")) && (
                        <p className="text-[0.8125rem] text-destructive">
                          {fieldError(at("quantity"))}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-3 sm:items-start">
                  {!item.bySize && (
                    <Field id={id("quantity")} label="Pieces" error={fieldError(at("quantity"))}>
                      <Input
                        id={id("quantity")}
                        inputMode="numeric"
                        value={item.quantity}
                        onChange={(e) => update(item.key, { quantity: e.target.value })}
                        placeholder="0"
                        className="text-right tabular-nums"
                        aria-invalid={Boolean(fieldError(at("quantity")))}
                      />
                    </Field>
                  )}
                  <Field
                    id={id("price")}
                    label={`Price per piece (${currency})`}
                    error={fieldError(at("unitPrice"))}
                  >
                    <Input
                      id={id("price")}
                      inputMode="decimal"
                      value={item.unitPrice}
                      onChange={(e) => update(item.key, { unitPrice: e.target.value })}
                      placeholder="0.00"
                      className="text-right tabular-nums"
                      aria-invalid={Boolean(fieldError(at("unitPrice")))}
                    />
                  </Field>
                  <div className="grid gap-2 sm:text-right">
                    <span className="text-sm font-medium">Line total</span>
                    <span className="flex h-11 items-center font-serif text-lg tabular-nums sm:justify-end md:h-9">
                      {money(lineTotal(item).toFixed(2), currency)}
                    </span>
                    {item.bySize && (
                      <span className="text-[0.8125rem] text-muted-foreground">
                        {formatCount(piecesOf(item), currency)} pcs
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto sm:justify-self-start"
          onClick={() => setItems((all) => [...all, emptyItem()])}
        >
          <PlusIcon aria-hidden />
          Add an item
        </Button>
      </Section>

      <Section
        title="Styling rules"
        hint="Instructions for the factory, such as “Placket should not have a black border”."
      >
        {rules.length > 0 && (
          <ul className="grid grid-cols-1 gap-3">
            {rules.map((rule, index) => (
              <li
                key={rule.key}
                className="grid min-w-0 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start"
              >
                <Input
                  value={rule.area}
                  maxLength={80}
                  placeholder="Area (collar, placket…)"
                  aria-label={`Area of rule ${index + 1}`}
                  onChange={(e) =>
                    setRules((all) =>
                      all.map((r) => (r.key === rule.key ? { ...r, area: e.target.value } : r)),
                    )
                  }
                />
                <div className="grid gap-1">
                  <Textarea
                    value={rule.instruction}
                    rows={2}
                    maxLength={1000}
                    placeholder="What to do"
                    aria-label={`Instruction of rule ${index + 1}`}
                    aria-invalid={Boolean(fieldError(`stylingRules.${index}.instruction`))}
                    onChange={(e) =>
                      setRules((all) =>
                        all.map((r) =>
                          r.key === rule.key ? { ...r, instruction: e.target.value } : r,
                        ),
                      )
                    }
                  />
                  {fieldError(`stylingRules.${index}.instruction`) && (
                    <p className="text-[0.8125rem] text-destructive">
                      {fieldError(`stylingRules.${index}.instruction`)}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => setRules((all) => all.filter((r) => r.key !== rule.key))}
                  aria-label={`Remove rule ${index + 1}`}
                >
                  <Trash2Icon aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto sm:justify-self-start"
          onClick={() => setRules((all) => [...all, { key: newKey(), area: "", instruction: "" }])}
        >
          <PlusIcon aria-hidden />
          Add a styling rule
        </Button>
      </Section>

      <Section title="Totals and terms">
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <Field id="discount" label={`Discount (${currency})`} error={fieldError("discount")}>
            <Input
              id="discount"
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0.00"
              className="text-right tabular-nums"
            />
          </Field>
          <Field id="tax" label={`Tax / VAT (${currency})`} error={fieldError("tax")}>
            <Input
              id="tax"
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="0.00"
              className="text-right tabular-nums"
            />
          </Field>
        </div>
        <dl className="grid gap-2 rounded-lg border bg-muted/40 p-4 text-sm tabular-nums sm:ml-auto sm:w-80">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{money(subtotal.toFixed(2), currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t pt-2 font-medium">
            <dt>Total</dt>
            <dd className="font-serif text-lg">{money(Math.max(total, 0).toFixed(2), currency)}</dd>
          </div>
        </dl>
        <Field
          id="terms"
          label="Terms (optional)"
          hint="Payment, delivery and validity terms printed on the quotation."
        >
          <Textarea
            id="terms"
            name="terms"
            rows={3}
            maxLength={4000}
            defaultValue={editing?.terms ?? ""}
            aria-describedby="terms-hint"
          />
        </Field>
        <Field id="notes" label="Notes (optional)">
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            maxLength={4000}
            defaultValue={editing?.notes ?? ""}
          />
        </Field>
      </Section>

      {data.customFields.length > 0 && (
        <Section title="More details">
          <div className="grid items-start gap-5 sm:grid-cols-2">
            {data.customFields.map((def) => {
              const id = `field-${def.key}`;
              const err = fieldError(`customFields.${def.key}`);
              const value = fields[def.key];
              const set = (v: string | boolean) => setFields((all) => ({ ...all, [def.key]: v }));
              const label = def.isRequired ? def.label : `${def.label} (optional)`;
              if (def.fieldType === "BOOLEAN") {
                return (
                  <label
                    key={def.key}
                    className="flex h-11 cursor-pointer items-center gap-2 self-end text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={value === true}
                      onChange={(e) => set(e.target.checked)}
                      className="size-4 cursor-pointer accent-primary"
                    />
                    {def.label}
                  </label>
                );
              }
              return (
                <Field
                  key={def.key}
                  id={id}
                  label={label}
                  error={err}
                  className={def.fieldType === "LONG_TEXT" ? "sm:col-span-2" : undefined}
                >
                  {def.fieldType === "LONG_TEXT" ? (
                    <Textarea
                      id={id}
                      rows={3}
                      value={String(value ?? "")}
                      onChange={(e) => set(e.target.value)}
                      aria-invalid={Boolean(err)}
                    />
                  ) : def.fieldType === "SELECT" ? (
                    <NativeSelect
                      id={id}
                      value={String(value ?? "")}
                      onChange={(e) => set(e.target.value)}
                      containerClassName="sm:w-full"
                      aria-invalid={Boolean(err)}
                    >
                      <option value="">Choose</option>
                      {def.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      id={id}
                      type={
                        def.fieldType === "DATE"
                          ? "date"
                          : def.fieldType === "COLOR"
                            ? "color"
                            : "text"
                      }
                      inputMode={def.fieldType === "NUMBER" ? "decimal" : undefined}
                      value={String(value ?? (def.fieldType === "COLOR" ? "#000000" : ""))}
                      onChange={(e) => set(e.target.value)}
                      aria-invalid={Boolean(err)}
                      className={def.fieldType === "COLOR" ? "h-11 w-20 p-1 md:h-9" : undefined}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </Section>
      )}

      {hasFieldErrors && <FormAlert>Please check the highlighted fields.</FormAlert>}
      {error && error.code !== "INTERNAL" && !error.fieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={editing ? salesHref.quotation(editing.id) : "/sales/quotations"}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Saving" : editing ? "Save the changes" : "Save the quotation"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the quotation"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}
