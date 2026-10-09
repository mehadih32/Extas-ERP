"use client";

import type { PaymentMethod, SalesChannel } from "@prisma/client";
import { LoaderCircleIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount } from "@/components/products/form-values";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { OrderForm as OrderFormData, SaleMatrix } from "@/modules/sales/screens.service";
import {
  convertProformaToOrderAction,
  createOrderAction,
  getSaleMatrixAction,
  updateOrderAction,
} from "@/server/actions/sales.actions";

import { ColorName } from "./detail-bits";
import {
  CHANNEL_HINTS,
  CHANNEL_LABELS,
  METHOD_LABELS,
  money,
  salesHref,
  usesWholesalePrice,
} from "./labels";
import { BuyerPicker, StylePicker } from "./pickers";

type Buyer = { id: string; code: string; name: string };

/** One style on the order: its matrix, a price for every piece of it, and pieces per SKU. */
type Block = {
  key: string;
  styleId: string;
  matrix: SaleMatrix | null;
  loadError?: string;
  unitPrice: string;
  quantities: Record<string, string>;
  /** Editing: its SKUs had different prices or line discounts before. */
  mixedPrices: boolean;
};

// Styles added in the browser get keys from this counter; the ones the page
// starts with are keyed by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `style-${++nextKey}`;

const wholeNumber = (text: string | undefined) =>
  text !== undefined && /^\d{1,7}$/.test(text.trim()) ? Number(text) : null;

const blockPieces = (block: Block) =>
  Object.values(block.quantities).reduce((sum, q) => sum + (wholeNumber(q) ?? 0), 0);

/** "4,500.00" for the totals preview. */
const fixed2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
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

function Tick({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-[0.8125rem] leading-snug text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/** The SKUs short of stock: requested beyond what is ready (plus what this order already holds). */
function shortSkus(blocks: Block[], own: Record<string, number>) {
  const short: Record<string, string> = {};
  for (const block of blocks) {
    for (const row of block.matrix?.rows ?? []) {
      for (const cell of row.cells) {
        if (!cell) continue;
        const wanted = wholeNumber(block.quantities[cell.variantId]) ?? 0;
        const ready = Math.max(cell.available, 0) + (own[cell.variantId] ?? 0);
        if (wanted > ready) short[cell.sku] = `Requested ${wanted}, ready ${ready}`;
      }
    }
  }
  return short;
}

/**
 * The order form (blueprint checkout): the channel and buyer (or walk-in
 * customer), the warehouse, styles picked from the catalogue with pieces per
 * colour and size against the stock ready, one price per style (empty uses the
 * list price for the channel), charges, the documents to make and money taken
 * at checkout. Selling beyond stock offers Force Override only to people who
 * hold it. Used for new orders, for editing one before anything leaves the
 * warehouse, and for making the order from a proforma.
 */
export function OrderForm({ form: data }: { form: OrderFormData }) {
  const router = useRouter();
  const editing = data.order;
  const proforma = data.proforma;
  const currency = data.currency;
  const defaultWarehouse =
    editing?.warehouseId ??
    data.warehouses.find((w) => w.isDefault)?.id ??
    data.warehouses[0]?.id ??
    "";

  const [channel, setChannel] = useState<SalesChannel>(
    editing?.channel ?? (proforma ? "B2B_PREORDER" : (data.channels[0] ?? "WHOLESALE")),
  );
  const [buyer, setBuyer] = useState<Buyer | null>(editing?.buyer ?? proforma?.buyer ?? null);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (editing) {
      return editing.styles.map((s, index) => ({
        key: `start-${index}`,
        styleId: s.styleId,
        matrix: null,
        unitPrice: s.unitPrice ?? "",
        quantities: Object.fromEntries(
          Object.entries(s.quantities).map(([variantId, q]) => [variantId, String(q)]),
        ),
        mixedPrices: s.mixedPrices,
      }));
    }
    if (proforma) {
      return proforma.styleIds.map((styleId, index) => ({
        key: `start-${index}`,
        styleId,
        matrix: null,
        unitPrice: proforma.items.find((i) => i.style?.id === styleId)?.unitPrice ?? "",
        quantities: {},
        mixedPrices: false,
      }));
    }
    return [];
  });
  const [discount, setDiscount] = useState(
    editing && Number(editing.discount) ? editing.discount : "",
  );
  const [shipping, setShipping] = useState(
    editing && Number(editing.shippingCharge) ? editing.shippingCharge : "",
  );
  const [tax, setTax] = useState(editing && Number(editing.tax) ? editing.tax : "");
  const [documents, setDocuments] = useState({
    invoice: true,
    packingList: false,
    deliveryChallan: false,
  });
  const [takePayment, setTakePayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [override, setOverride] = useState(false);
  const [serverShort, setServerShort] = useState<Record<string, string>>({});
  const [error, setError] = useState<ActionError>();
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const fieldError = (name: string) => problems[name] ?? error?.fieldErrors?.[name]?.[0];
  const wholesale = usesWholesalePrice(channel);
  const buyerNeeded = wholesale;
  const locked = Boolean(editing || proforma);
  /** What this order already holds, counted as ready when editing it. */
  const own: Record<string, number> = {};
  for (const s of editing?.styles ?? []) {
    for (const [variantId, q] of Object.entries(s.quantities)) own[variantId] = q;
  }

  // Matrices of the styles already on the order (or the proforma) load once.
  useEffect(() => {
    let live = true;
    const ids = data.order
      ? data.order.styles.map((s) => s.styleId)
      : (data.proforma?.styleIds ?? []);
    const warehouse =
      data.order?.warehouseId ?? data.warehouses.find((w) => w.isDefault)?.id ?? undefined;
    for (const styleId of ids) {
      void getSaleMatrixAction(styleId, warehouse ?? undefined).then((result) => {
        if (!live) return;
        setBlocks((all) =>
          all.map((b) =>
            b.styleId !== styleId
              ? b
              : result.ok
                ? { ...b, matrix: result.data, quantities: prefill(b, result.data, data) }
                : { ...b, loadError: result.error.message },
          ),
        );
      });
    }
    return () => {
      live = false;
    };
  }, [data]);

  async function loadBlock(key: string, styleId: string, warehouse: string) {
    const result = await getSaleMatrixAction(styleId, warehouse || undefined);
    setBlocks((all) =>
      all.map((b) =>
        b.key !== key
          ? b
          : result.ok
            ? { ...b, matrix: result.data, loadError: undefined }
            : { ...b, loadError: result.error.message },
      ),
    );
  }

  function changeWarehouse(id: string) {
    setWarehouseId(id);
    setServerShort({});
    for (const block of blocks) void loadBlock(block.key, block.styleId, id);
  }

  function changeChannel(next: SalesChannel) {
    setChannel(next);
    setDocuments((d) => ({ ...d, deliveryChallan: next === "POS" }));
  }

  const updateBlock = (key: string, change: Partial<Block>) =>
    setBlocks((all) => all.map((b) => (b.key === key ? { ...b, ...change } : b)));

  const cellPrice = (block: Block, cell: { wholesalePrice: string; retailPrice: string }) => {
    const typed = readAmount(block.unitPrice);
    if (typeof typed === "number") return typed;
    return Number(wholesale ? cell.wholesalePrice : cell.retailPrice);
  };
  const blockAmount = (block: Block) =>
    (block.matrix?.rows ?? []).reduce(
      (sum, row) =>
        sum +
        row.cells.reduce(
          (s, cell) =>
            cell
              ? s + (wholeNumber(block.quantities[cell.variantId]) ?? 0) * cellPrice(block, cell)
              : s,
          0,
        ),
      0,
    );

  const pieces = blocks.reduce((sum, b) => sum + blockPieces(b), 0);
  const subtotal = blocks.reduce((sum, b) => sum + blockAmount(b), 0);
  const charge = (text: string) => {
    const value = readAmount(text);
    return typeof value === "number" ? value : 0;
  };
  const total = Math.max(subtotal - charge(discount) + charge(shipping) + charge(tax), 0);
  const paidBefore = editing ? Number(editing.paid) : proforma ? Number(proforma.advancePaid) : 0;
  const short = { ...shortSkus(blocks, own), ...serverShort };
  const shortCount = Object.keys(short).length;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    const found: Record<string, string> = {};
    if (buyerNeeded && !buyer) found.partyId = "Choose the buyer.";
    if (pieces < 1) found.lines = "Add a style and enter the pieces.";
    blocks.forEach((block) => {
      if (readAmount(block.unitPrice) === "invalid") found[`price.${block.key}`] = AMOUNT_HINT;
      for (const [variantId, q] of Object.entries(block.quantities)) {
        if (q.trim() && wholeNumber(q) === null) found[`qty.${variantId}`] = "Whole pieces";
      }
    });
    for (const [name, value] of [
      ["discount", discount],
      ["shippingCharge", shipping],
      ["tax", tax],
    ] as const) {
      if (readAmount(value) === "invalid") found[name] = AMOUNT_HINT;
    }
    const orderDate = text("orderDate");
    const shipmentDate = text("shipmentDate");
    if (shipmentDate && shipmentDate < (orderDate || data.today)) {
      found.shipmentDate = "Choose a day on or after the order date.";
    }
    let payment: { amount: number; method: PaymentMethod; reference?: string } | undefined;
    if (takePayment) {
      const amount = readAmount(paymentAmount);
      if (amount === "invalid") found["payment.amount"] = AMOUNT_HINT;
      else if (amount === null || amount <= 0) found["payment.amount"] = "Enter the amount paid.";
      else if (amount > total + 0.001) found["payment.amount"] = `At most ${fixed2(total)}.`;
      else {
        payment = {
          amount,
          method: (text("paymentMethod") || "CASH") as PaymentMethod,
          reference: text("paymentReference") || undefined,
        };
      }
    }
    const overrideReason = text("overrideReason");
    if (override && overrideReason.length < 5) {
      found.overrideReason = "Write at least 5 letters.";
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return;

    const matrix = blocks
      .filter((b) => blockPieces(b) > 0)
      .map((b) => {
        const price = readAmount(b.unitPrice);
        return {
          styleId: b.styleId,
          ...(typeof price === "number" ? { unitPrice: price } : {}),
          quantities: Object.fromEntries(
            Object.entries(b.quantities)
              .map(([variantId, q]) => [variantId, wholeNumber(q) ?? 0] as const)
              .filter(([, q]) => q > 0),
          ),
        };
      });
    const charges = {
      discount: charge(discount),
      shippingCharge: charge(shipping),
      tax: charge(tax),
      notes: text("notes") || null,
      customerName: text("customerName") || null,
      customerPhone: text("customerPhone") || null,
      shippingAddress: text("shippingAddress") || null,
      ...(override ? { forceOverride: { reason: overrideReason } } : {}),
    };

    startTransition(async () => {
      const result = editing
        ? await updateOrderAction(editing.id, { matrix, ...charges })
        : proforma
          ? await convertProformaToOrderAction(proforma.id, {
              warehouseId: warehouseId || undefined,
              orderDate: orderDate && orderDate !== data.today ? orderDate : undefined,
              shipmentDate: shipmentDate || null,
              matrix,
              ...charges,
            })
          : await createOrderAction({
              channel,
              partyId: buyer?.id ?? null,
              warehouseId: warehouseId || undefined,
              orderDate: orderDate && orderDate !== data.today ? orderDate : undefined,
              shipmentDate: shipmentDate || null,
              matrix,
              ...charges,
              documents,
              ...(payment ? { payment } : {}),
            });
      if (!result.ok) {
        const stock = Object.entries(result.error.fieldErrors ?? {})
          .filter(([key]) => key.startsWith("stock."))
          .map(([key, messages]) => [key.slice("stock.".length), messages[0] ?? ""] as const);
        setServerShort(Object.fromEntries(stock));
        setError(result.error);
        return;
      }
      router.push(`${salesHref.order(result.data.id)}?${editing ? "saved" : "created"}=1`);
    });
  }

  const hasFieldErrors =
    Object.keys(problems).length > 0 ||
    Object.keys(error?.fieldErrors ?? {}).some((key) => !key.startsWith("stock."));

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-8" noValidate>
      <Section title={locked ? "Order" : "Who it is for"}>
        {!locked ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Channel</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {data.channels.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={channel === c}
                  onClick={() => changeChannel(c)}
                  className={cn(
                    "grid cursor-pointer gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                    channel === c
                      ? "border-primary/50 bg-secondary text-primary"
                      : "bg-card hover:border-primary/30",
                  )}
                >
                  <span className="text-sm font-medium">{CHANNEL_LABELS[c]}</span>
                  {CHANNEL_HINTS[c] && (
                    <span className="text-[0.8125rem] leading-snug text-muted-foreground">
                      {CHANNEL_HINTS[c]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">
            {CHANNEL_LABELS[channel]}
            {proforma ? ` from proforma ${proforma.number}` : ""}
            {editing ? ` · ${editing.number}` : ""}
          </p>
        )}
        <Field
          id="order-buyer"
          label={buyerNeeded ? "Buyer" : "Buyer (optional)"}
          hint={
            buyerNeeded || locked
              ? undefined
              : "Leave empty for a walk-in customer; their name and phone can go below."
          }
          error={fieldError("partyId")}
        >
          {locked && !buyer ? (
            <p className="rounded-md border bg-card px-3 py-2 text-sm">Walk-in customer</p>
          ) : (
            <BuyerPicker
              id="order-buyer"
              value={buyer}
              onChange={setBuyer}
              currency={currency}
              locked={locked}
              invalid={Boolean(fieldError("partyId"))}
              describedBy={
                fieldError("partyId")
                  ? "order-buyer-error"
                  : !buyerNeeded && !locked
                    ? "order-buyer-hint"
                    : undefined
              }
            />
          )}
        </Field>
        {!editing && (
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="orderDate" label="Order date">
              <Input
                id="orderDate"
                name="orderDate"
                type="date"
                defaultValue={data.today}
                max={data.today}
              />
            </Field>
            <Field
              id="shipmentDate"
              label="Ship by (optional)"
              hint="The day it is due to leave the warehouse."
              error={fieldError("shipmentDate")}
            >
              <Input
                id="shipmentDate"
                name="shipmentDate"
                type="date"
                min={data.today}
                aria-describedby={
                  fieldError("shipmentDate") ? "shipmentDate-error" : "shipmentDate-hint"
                }
              />
            </Field>
          </div>
        )}
        {data.warehouses.length > 1 && (
          <Field
            id="warehouse"
            label="Warehouse"
            hint={
              editing
                ? "An order keeps the warehouse it was made from."
                : "The goods come out of this one."
            }
          >
            <NativeSelect
              id="warehouse"
              value={warehouseId}
              onChange={(e) => changeWarehouse(e.target.value)}
              disabled={Boolean(editing)}
              containerClassName="sm:w-full sm:max-w-sm"
              aria-describedby="warehouse-hint"
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </Section>

      <Section
        title="Items"
        hint={
          <>
            Pick a style, then enter the pieces for each colour and size. Prices are{" "}
            {wholesale ? "wholesale" : "retail"}; a price typed for a style applies to all of it.
          </>
        }
      >
        {proforma && proforma.items.length > 0 && (
          <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium">The proforma asked for</p>
            <ul className="mt-2 grid gap-1 text-muted-foreground">
              {proforma.items.map((item) => (
                <li key={item.id} className="break-words">
                  {item.description} · {formatCount(item.quantity, currency)} pcs ×{" "}
                  {money(item.unitPrice, currency)}
                  {item.sizes
                    ? ` (${item.sizes.map((s) => `${s.size} ${s.quantity}`).join(", ")})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {blocks.length > 0 && (
          <ol className="grid grid-cols-1 gap-4">
            {blocks.map((block) => (
              <StyleBlock
                key={block.key}
                block={block}
                wholesale={wholesale}
                currency={currency}
                own={own}
                short={short}
                fieldError={fieldError}
                amount={blockAmount(block)}
                onChange={(change) => updateBlock(block.key, change)}
                onRemove={() => setBlocks((all) => all.filter((b) => b.key !== block.key))}
              />
            ))}
          </ol>
        )}
        <Field
          id="add-style"
          label={blocks.length === 0 ? "Add a style" : "Add another style"}
          error={fieldError("lines") ?? fieldError("matrix")}
        >
          <StylePicker
            id="add-style"
            currency={currency}
            exclude={blocks.map((b) => b.styleId)}
            onPick={(style) => {
              const key = newKey();
              setBlocks((all) => [
                ...all,
                {
                  key,
                  styleId: style.id,
                  matrix: null,
                  unitPrice: "",
                  quantities: {},
                  mixedPrices: false,
                },
              ]);
              void loadBlock(key, style.id, warehouseId);
            }}
          />
        </Field>
      </Section>

      <Section title="Charges and notes">
        <div className="grid items-start gap-5 sm:grid-cols-3">
          {(
            [
              ["discount", "Discount", discount, setDiscount],
              ["shippingCharge", "Delivery charge", shipping, setShipping],
              ["tax", "Tax / VAT", tax, setTax],
            ] as const
          ).map(([name, label, value, set]) => (
            <Field
              key={name}
              id={`order-${name}`}
              label={`${label} (${currency})`}
              error={fieldError(name)}
            >
              <Input
                id={`order-${name}`}
                inputMode="decimal"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder="0.00"
                autoComplete="off"
                aria-invalid={Boolean(fieldError(name))}
              />
            </Field>
          ))}
        </div>
        {!wholesale && (
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field id="customerName" label="Customer name (optional)">
              <Input
                id="customerName"
                name="customerName"
                maxLength={120}
                defaultValue={editing?.customerName ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field id="customerPhone" label="Customer phone (optional)">
              <Input
                id="customerPhone"
                name="customerPhone"
                type="tel"
                maxLength={30}
                defaultValue={editing?.customerPhone ?? ""}
                autoComplete="off"
              />
            </Field>
            <Field
              id="shippingAddress"
              label="Delivery address (optional)"
              className="sm:col-span-2"
            >
              <Textarea
                id="shippingAddress"
                name="shippingAddress"
                rows={2}
                maxLength={500}
                defaultValue={editing?.shippingAddress ?? ""}
              />
            </Field>
          </div>
        )}
        <Field id="order-notes" label="Notes (optional)">
          <Textarea
            id="order-notes"
            name="notes"
            rows={2}
            maxLength={4000}
            defaultValue={editing?.notes ?? ""}
          />
        </Field>
      </Section>

      {!locked && (
        <Section title="At checkout">
          <div className="grid gap-4">
            <Tick
              id="doc-invoice"
              checked={documents.invoice}
              onChange={(invoice) => setDocuments((d) => ({ ...d, invoice }))}
              label="Issue the invoice"
              hint="The buyer owes the order from today; the invoice can also be issued later."
            />
            <Tick
              id="doc-packing"
              checked={documents.packingList}
              onChange={(packingList) => setDocuments((d) => ({ ...d, packingList }))}
              label="Make the packing list"
            />
            <Tick
              id="doc-challan"
              checked={documents.deliveryChallan}
              onChange={(deliveryChallan) => setDocuments((d) => ({ ...d, deliveryChallan }))}
              label="Hand the goods over now (delivery challan)"
              hint="Takes every piece out of stock now, as at a counter sale."
            />
          </div>
          {data.can.takePayment && (
            <div className="grid gap-4">
              <Tick
                id="take-payment"
                checked={takePayment}
                onChange={(on) => {
                  setTakePayment(on);
                  if (on && !paymentAmount && total > 0) setPaymentAmount(fixed2(total));
                }}
                label="Payment received now"
                hint="A money receipt is made with the order."
              />
              {takePayment && (
                <div className="grid items-start gap-5 sm:grid-cols-3">
                  <Field
                    id="payment-amount"
                    label={`Amount (${currency})`}
                    error={fieldError("payment.amount")}
                  >
                    <Input
                      id="payment-amount"
                      inputMode="decimal"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0.00"
                      autoComplete="off"
                      aria-invalid={Boolean(fieldError("payment.amount"))}
                    />
                  </Field>
                  <Field id="payment-method" label="Paid by">
                    <NativeSelect
                      id="payment-method"
                      name="paymentMethod"
                      defaultValue="CASH"
                      containerClassName="sm:w-full"
                    >
                      {data.paymentMethods.map((m) => (
                        <option key={m} value={m}>
                          {METHOD_LABELS[m]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="payment-reference" label="Reference (optional)">
                    <Input
                      id="payment-reference"
                      name="paymentReference"
                      maxLength={120}
                      autoComplete="off"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      <section
        aria-label="Order total"
        className="grid gap-2 rounded-lg border bg-card p-5 text-sm tabular-nums"
      >
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>Subtotal · {formatCount(pieces, currency)} pcs</span>
          <span>{money(fixed2(subtotal), currency)}</span>
        </div>
        {charge(discount) > 0 && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Discount</span>
            <span>− {money(fixed2(charge(discount)), currency)}</span>
          </div>
        )}
        {charge(shipping) > 0 && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Delivery charge</span>
            <span>{money(fixed2(charge(shipping)), currency)}</span>
          </div>
        )}
        {charge(tax) > 0 && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <span>Tax / VAT</span>
            <span>{money(fixed2(charge(tax)), currency)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4 border-t pt-2 font-medium">
          <span>Total</span>
          <span className="font-serif text-lg">{money(fixed2(total), currency)}</span>
        </div>
        {paidBefore > 0 && (
          <>
            <div className="flex justify-between gap-4 text-muted-foreground">
              <span>{proforma ? "Advance already paid" : "Paid so far"}</span>
              <span>{money(fixed2(paidBefore), currency)}</span>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <span>Left to pay</span>
              <span>{money(fixed2(Math.max(total - paidBefore, 0)), currency)}</span>
            </div>
          </>
        )}
        <p className="text-[0.8125rem] text-muted-foreground">
          The order works out the final figures when it is saved.
        </p>
      </section>

      {shortCount > 0 && (
        <div
          role="alert"
          className="grid gap-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 sm:p-5"
        >
          <div className="flex items-start gap-2.5 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <div className="grid gap-1">
              <p className="font-medium">
                {shortCount === 1 ? "One SKU is" : `${shortCount} SKUs are`} short of stock
              </p>
              <ul className="text-muted-foreground">
                {Object.entries(short).map(([sku, message]) => (
                  <li key={sku}>
                    <span className="font-medium text-foreground">{sku}</span>: {message}
                  </li>
                ))}
              </ul>
              {!data.can.forceOverride && (
                <p>Lower the pieces marked, or ask someone who may sell beyond stock.</p>
              )}
            </div>
          </div>
          {data.can.forceOverride && (
            <div className="grid gap-4">
              <Tick
                id="force-override"
                checked={override}
                onChange={setOverride}
                label="Force Override & Sell"
                hint="Sells the pieces anyway. Stock goes below zero until it is made, and the order is flagged."
              />
              {override && (
                <Field
                  id="override-reason"
                  label="Why"
                  hint="Kept on the order and in the activity log."
                  error={fieldError("overrideReason") ?? fieldError("forceOverride.reason")}
                >
                  <Textarea
                    id="override-reason"
                    name="overrideReason"
                    rows={2}
                    maxLength={500}
                    aria-describedby="override-reason-hint"
                  />
                </Field>
              )}
            </div>
          )}
        </div>
      )}

      {hasFieldErrors && <FormAlert>Please check the highlighted fields.</FormAlert>}
      {error &&
        error.code !== "INTERNAL" &&
        error.code !== "INSUFFICIENT_STOCK" &&
        !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}

      <div className="flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link
            href={
              editing
                ? salesHref.order(editing.id)
                : proforma
                  ? salesHref.proforma(proforma.id)
                  : "/sales/orders"
            }
          >
            Cancel
          </Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending
            ? "Saving"
            : editing
              ? "Save the changes"
              : proforma
                ? "Make the order"
                : "Place the order"}
        </Button>
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the order"
          onClose={() => setError(undefined)}
        />
      )}
    </form>
  );
}

/**
 * Converting a proforma: when the style comes in one colour, the quotation's
 * size breakdown fills the pieces in. Otherwise (and when editing) the
 * quantities stay as they are.
 */
function prefill(block: Block, matrix: SaleMatrix, data: OrderFormData): Record<string, string> {
  if (!data.proforma || Object.keys(block.quantities).length > 0 || matrix.rows.length !== 1) {
    return block.quantities;
  }
  const item = data.proforma.items.find((i) => i.style?.id === block.styleId);
  if (!item?.sizes) return block.quantities;
  const row = matrix.rows[0]!;
  const filled: Record<string, string> = {};
  matrix.sizes.forEach((size, index) => {
    const cell = row.cells[index];
    const wanted = item.sizes!.find((s) => s.size === size.name)?.quantity;
    if (cell && wanted) filled[cell.variantId] = String(wanted);
  });
  return filled;
}

function StyleBlock({
  block,
  wholesale,
  currency,
  own,
  short,
  fieldError,
  amount,
  onChange,
  onRemove,
}: {
  block: Block;
  wholesale: boolean;
  currency: string;
  own: Record<string, number>;
  short: Record<string, string>;
  fieldError: (name: string) => string | undefined;
  amount: number;
  onChange: (change: Partial<Block>) => void;
  onRemove: () => void;
}) {
  const m = block.matrix;
  const title = m ? `${m.style.code} · ${m.style.name}` : "Loading the style";
  const listPrice = m ? (wholesale ? m.style.wholesalePrice : m.style.retailPrice) : "";
  const priceId = `${block.key}-price`;
  const pieces = blockPieces(block);

  return (
    <li className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium break-words">{title}</p>
          {m && (
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {formatCount(pieces, currency)} pcs · {money(fixed2(amount), currency)}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${m ? m.style.code : "this style"}`}
        >
          <Trash2Icon aria-hidden />
          Remove
        </Button>
      </div>

      {block.loadError ? (
        <FormAlert>{block.loadError}</FormAlert>
      ) : !m ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
          Loading colours and sizes
        </p>
      ) : (
        <>
          <Field
            id={priceId}
            label={`Price per piece (${currency})`}
            hint={
              block.mixedPrices
                ? "Its pieces had different prices or discounts; saving gives them this one price (empty: the list price)."
                : `Empty uses the ${wholesale ? "wholesale" : "retail"} list price, ${listPrice}.`
            }
            error={fieldError(`price.${block.key}`)}
          >
            <Input
              id={priceId}
              inputMode="decimal"
              value={block.unitPrice}
              onChange={(e) => onChange({ unitPrice: e.target.value })}
              placeholder={listPrice}
              autoComplete="off"
              className="sm:w-40"
              aria-invalid={Boolean(fieldError(`price.${block.key}`))}
              aria-describedby={
                fieldError(`price.${block.key}`) ? `${priceId}-error` : `${priceId}-hint`
              }
            />
          </Field>
          {!m.style.isActive && (
            <FormAlert tone="note">
              This style is archived; it can be sold only from stock left.
            </FormAlert>
          )}
          <div className="grid grid-cols-1 gap-4">
            {m.rows.map((row) => (
              <fieldset key={row.color.id} className="grid min-w-0 gap-2">
                <legend className="mb-1 text-sm font-medium">
                  <ColorName name={row.color.name} hexCode={row.color.hexCode} />
                </legend>
                <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 sm:grid-cols-6">
                  {row.cells.map((cell, index) => {
                    const size = m.sizes[index]!;
                    if (!cell) return null;
                    const ready = Math.max(cell.available, 0) + (own[cell.variantId] ?? 0);
                    const isShort = Boolean(short[cell.sku]);
                    const bad = Boolean(fieldError(`qty.${cell.variantId}`));
                    const inputId = `${block.key}-${cell.variantId}`;
                    return (
                      <div key={cell.variantId} className="grid min-w-0 gap-1">
                        <label
                          htmlFor={inputId}
                          className="flex items-baseline justify-between gap-1 text-[0.8125rem]"
                        >
                          <span className="font-medium">{size.name}</span>
                          <span
                            className={cn(
                              "truncate tabular-nums",
                              isShort ? "text-amber-700" : "text-muted-foreground",
                            )}
                          >
                            {ready} ready
                          </span>
                        </label>
                        <Input
                          id={inputId}
                          inputMode="numeric"
                          value={block.quantities[cell.variantId] ?? ""}
                          onChange={(e) =>
                            onChange({
                              quantities: { ...block.quantities, [cell.variantId]: e.target.value },
                            })
                          }
                          disabled={!cell.isActive && !block.quantities[cell.variantId]}
                          placeholder="0"
                          aria-label={`${row.color.name} ${size.name}, pieces (${ready} ready)`}
                          aria-invalid={bad || isShort}
                          className={cn(
                            "text-right tabular-nums",
                            isShort && "border-amber-500 focus-visible:border-amber-500",
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </>
      )}
    </li>
  );
}
