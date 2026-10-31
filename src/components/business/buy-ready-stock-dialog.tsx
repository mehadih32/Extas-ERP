"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PaidFromFields } from "@/components/accounts/money-fields";
import { PinField } from "@/components/ai/pin-prompt";
import { Field } from "@/components/forms/field";
import {
  type ChartValue,
  chartInput,
  SizeChartEditor,
  startChart,
} from "@/components/products/size-chart-editor";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { ShopStockPage } from "@/modules/retail/shop-stock.service";
import { buyReadyStockAction } from "@/server/actions/retail.actions";

/*
 * "Buy ready stock" (2026-10-31): everything about buying finished goods in one
 * window. Who sold them (from the list, a new supplier, or a one-time "random"
 * one), which style (or a new one), the colours and sizes with the pieces of
 * each, one price for the style, the extra costs on the same bill, what is paid
 * now and from where, and the shops' price.
 */

type SupplierMode = "PICK" | "NEW" | "RANDOM";
type PaymentMode = "DUE" | "PART" | "FULL";

const PRICE_MODE: Record<string, string> = {
  RULE: "Shop's own rule",
  FIXED: "One price",
  AT_COST: "At cost",
};

/** A row of choice buttons (radio buttons that look like tabs). */
function Choices<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm md:min-h-9",
              value === o.value ? "border-primary/40 bg-secondary" : "hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="size-4 cursor-pointer accent-primary"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Ticks for colours or sizes. */
function Ticks({
  legend,
  items,
  chosen,
  onChange,
}: {
  legend: string;
  items: ReadonlyArray<{ id: string; name: string }>;
  chosen: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const on = chosen.includes(item.id);
          return (
            <label
              key={item.id}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm md:min-h-9",
                on ? "border-primary/40 bg-secondary" : "hover:bg-muted",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...chosen, item.id] : chosen.filter((c) => c !== item.id),
                  )
                }
                className="size-4 cursor-pointer accent-primary"
              />
              {item.name}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const asNumber = (v: string) => {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && n > 0 ? n : 0;
};

export function BuyReadyStockDialog({
  page,
  onClose,
}: {
  page: ShopStockPage;
  onClose: () => void;
}) {
  const router = useRouter();
  const { currency } = page;
  const money = (n: number) => `${currency} ${groupAmount(n.toFixed(2), currency)}`;
  const [supplierMode, setSupplierMode] = useState<SupplierMode>(
    page.suppliers.length ? "PICK" : "RANDOM",
  );
  const [styleMode, setStyleMode] = useState<"PICK" | "NEW">(page.styles.length ? "PICK" : "NEW");
  const [styleId, setStyleId] = useState(page.styles[0]?.id ?? "");
  const style = page.styles.find((s) => s.id === styleId);
  // The colours and sizes ticked: at first those the style has.
  const own = (s: typeof style) => ({
    colours: [...new Set(s?.variants.map((v) => v.colorId) ?? [])],
    sizes: [...new Set(s?.variants.map((v) => v.sizeId) ?? [])],
  });
  const [colourIds, setColourIds] = useState(own(style).colours);
  const [sizeIds, setSizeIds] = useState(own(style).sizes);
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [priceBasis, setPriceBasis] = useState<"PIECE" | "TOTAL">("PIECE");
  const [price, setPrice] = useState("");
  const [extras, setExtras] = useState([{ label: "Transport", amount: "" }]);
  const [payment, setPayment] = useState<PaymentMode>("DUE");
  const [priceMode, setPriceMode] = useState("RULE");
  const [chart, setChart] = useState<ChartValue>(startChart());

  // Colours and sizes offered: all of the company's when the style may grow, else the style's own.
  const canGrow = page.canAddStyle;
  const colours = canGrow
    ? page.colours
    : page.colours.filter((c) => own(style).colours.includes(c.id));
  const sizes = canGrow ? page.sizes : page.sizes.filter((s) => own(style).sizes.includes(s.id));
  const shownColours = page.colours.filter((c) => colourIds.includes(c.id));
  const shownSizes = page.sizes.filter((s) => sizeIds.includes(s.id));

  const figures = useMemo(() => {
    const count = shownColours.reduce(
      (t, c) => t + shownSizes.reduce((u, s) => u + asNumber(pieces[`${c.id}:${s.id}`] ?? ""), 0),
      0,
    );
    const p = asNumber(price);
    const goods = priceBasis === "PIECE" ? p * count : p;
    const extra = extras.reduce((t, e) => t + asNumber(e.amount), 0);
    const total = goods + extra;
    return {
      count,
      goods,
      extra,
      total,
      perPiece: count ? goods / count : 0,
      costEach: count ? total / count : 0,
    };
  }, [shownColours, shownSizes, pieces, price, priceBasis, extras]);

  function pickStyle(id: string) {
    setStyleId(id);
    const next = own(page.styles.find((s) => s.id === id));
    setColourIds(next.colours);
    setSizeIds(next.sizes);
    setPieces({});
  }

  return (
    <FormDialog
      title="Buy ready stock"
      description="Finished pieces of one style. They come into Products at cost, and the bill goes to the supplier's account (paid now or due)."
      submitLabel="Save the purchase"
      pendingLabel="Saving"
      errorTitle="The purchase was not saved"
      className="sm:max-w-3xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const lines = shownColours.flatMap((c) =>
          shownSizes.flatMap((s) => {
            const quantity = (pieces[`${c.id}:${s.id}`] ?? "").trim();
            return quantity ? [{ colorId: c.id, sizeId: s.id, quantity }] : [];
          }),
        );
        const result = await buyReadyStockAction({
          supplier:
            supplierMode === "PICK"
              ? { mode: "PICK", supplierId: text("supplierId") }
              : {
                  mode: supplierMode,
                  name: text("supplierName"),
                  phone: text("supplierPhone"),
                  address: text("supplierAddress"),
                },
          style:
            styleMode === "PICK"
              ? { mode: "PICK", styleId }
              : {
                  mode: "NEW",
                  code: text("styleCode"),
                  name: text("styleName"),
                  categoryId: text("categoryId"),
                  sizeChart: chartInput({
                    ...chart,
                    points: chart.points.map((p) => ({
                      ...p,
                      values: Object.fromEntries(
                        Object.entries(p.values).filter(([id]) => sizeIds.includes(id)),
                      ),
                    })),
                  }),
                },
          warehouseId: text("warehouseId"),
          purchaseDate: text("purchaseDate"),
          supplierRef: text("supplierRef"),
          lines,
          priceBasis,
          price: price.trim(),
          extraCosts: extras
            .filter((e) => e.amount.trim())
            .map((e) => ({ label: e.label.trim(), amount: e.amount.trim() })),
          payment:
            payment === "DUE"
              ? { mode: "DUE" }
              : {
                  mode: payment,
                  amount: payment === "PART" ? text("paidNow") : undefined,
                  accountId: text("accountId"),
                  method: text("method"),
                  reference: text("reference"),
                },
          retailOnly: form.get("retailOnly") === "on",
          priceMode,
          fixedPrice: text("fixedPrice"),
          note: text("note"),
          pin: text("pin"),
        });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <section className="grid gap-3" aria-label="Supplier">
            <Choices
              name="supplierMode"
              legend="Supplier"
              value={supplierMode}
              onChange={setSupplierMode}
              options={[
                ...(page.suppliers.length
                  ? [{ value: "PICK" as const, label: "From the list" }]
                  : []),
                ...(page.canAddSupplier ? [{ value: "NEW" as const, label: "New supplier" }] : []),
                { value: "RANDOM" as const, label: "Random supplier" },
              ]}
            />
            {supplierMode === "PICK" ? (
              <Field
                id="buy-supplier"
                label="Pick the supplier"
                error={fieldError("supplier.supplierId")}
              >
                <NativeSelect id="buy-supplier" name="supplierId" containerClassName="sm:w-full">
                  {page.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <>
                {supplierMode === "RANDOM" && (
                  <p className="text-sm text-muted-foreground">
                    A one-time supplier: kept under Other suppliers in Buyers &amp; suppliers, with
                    its own account, not in the regular list.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="buy-supplier-name"
                    label={
                      supplierMode === "NEW" ? "Supplier's name" : "Supplier's name (optional)"
                    }
                    error={fieldError("supplier.name")}
                  >
                    <Input id="buy-supplier-name" name="supplierName" maxLength={120} />
                  </Field>
                  <Field
                    id="buy-supplier-phone"
                    label="Phone (optional)"
                    error={fieldError("supplier.phone")}
                  >
                    <Input
                      id="buy-supplier-phone"
                      name="supplierPhone"
                      inputMode="tel"
                      maxLength={30}
                    />
                  </Field>
                </div>
                <Field
                  id="buy-supplier-address"
                  label="Address (optional)"
                  error={fieldError("supplier.address")}
                >
                  <Input id="buy-supplier-address" name="supplierAddress" maxLength={300} />
                </Field>
              </>
            )}
          </section>

          <section className="grid gap-3" aria-label="Style">
            {page.canAddStyle && (
              <Choices
                name="styleMode"
                legend="Style"
                value={styleMode}
                onChange={(m) => {
                  setStyleMode(m);
                  if (m === "NEW") {
                    setColourIds([]);
                    setSizeIds([]);
                    setPieces({});
                  } else pickStyle(styleId);
                }}
                options={[
                  ...(page.styles.length
                    ? [{ value: "PICK" as const, label: "From Products" }]
                    : []),
                  { value: "NEW" as const, label: "New style" },
                ]}
              />
            )}
            {styleMode === "PICK" ? (
              <Field id="buy-style" label="Pick the style" error={fieldError("style.styleId")}>
                <NativeSelect
                  id="buy-style"
                  value={styleId}
                  onChange={(e) => pickStyle(e.target.value)}
                  containerClassName="sm:w-full"
                >
                  {page.styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="buy-style-code" label="Style code" error={fieldError("style.code")}>
                  <Input
                    id="buy-style-code"
                    name="styleCode"
                    placeholder="EX-PN-001"
                    maxLength={40}
                  />
                </Field>
                <Field id="buy-style-name" label="Style name" error={fieldError("style.name")}>
                  <Input id="buy-style-name" name="styleName" placeholder="Cotton chino pant" />
                </Field>
                <Field id="buy-category" label="Category" error={fieldError("style.categoryId")}>
                  <NativeSelect id="buy-category" name="categoryId" containerClassName="sm:w-full">
                    {page.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="buy-warehouse" label="Warehouse" error={fieldError("warehouseId")}>
              <NativeSelect id="buy-warehouse" name="warehouseId" containerClassName="sm:w-full">
                {page.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="buy-date" label="Date" error={fieldError("purchaseDate")}>
              <Input id="buy-date" name="purchaseDate" type="date" />
            </Field>
            <Field id="buy-ref" label="Supplier's bill no." error={fieldError("supplierRef")}>
              <Input id="buy-ref" name="supplierRef" maxLength={60} />
            </Field>
          </div>

          <section className="grid gap-3" aria-label="Pieces">
            <Ticks legend="Colours" items={colours} chosen={colourIds} onChange={setColourIds} />
            <Ticks legend="Sizes" items={sizes} chosen={sizeIds} onChange={setSizeIds} />
            {fieldError("lines") && (
              <p className="text-sm text-destructive">{fieldError("lines")}</p>
            )}
            {shownColours.length > 0 && shownSizes.length > 0 && (
              <div className="min-w-0 overflow-x-auto rounded-md border">
                <table className="w-full min-w-max text-sm" aria-label="Pieces by colour and size">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className="px-2 py-2 font-medium">
                        Pieces
                      </th>
                      {shownSizes.map((s) => (
                        <th key={s.id} scope="col" className="px-2 py-2 text-center font-medium">
                          {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shownColours.map((c) => (
                      <tr key={c.id} className="border-t">
                        <th scope="row" className="px-2 py-1.5 text-left font-normal">
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-3 shrink-0 rounded-full border"
                              style={{ background: c.hexCode }}
                            />
                            {c.name}
                          </span>
                        </th>
                        {shownSizes.map((s) => (
                          <td key={s.id} className="px-1 py-1.5">
                            <Input
                              value={pieces[`${c.id}:${s.id}`] ?? ""}
                              inputMode="numeric"
                              className="w-20 text-center"
                              aria-label={`Pieces of ${c.name} ${s.name}`}
                              onChange={(e) =>
                                setPieces((p) => ({ ...p, [`${c.id}:${s.id}`]: e.target.value }))
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {styleMode === "NEW" && shownSizes.length > 0 && (
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Size chart (optional)
                </summary>
                <div className="mt-3">
                  <SizeChartEditor
                    idPrefix="buy-chart"
                    sizes={shownSizes}
                    value={chart}
                    onChange={setChart}
                    error={fieldError("style.sizeChart.points")}
                  />
                </div>
              </details>
            )}
          </section>

          <section className="grid gap-3" aria-label="Price">
            <Choices
              name="priceBasis"
              legend="Price for the style"
              value={priceBasis}
              onChange={setPriceBasis}
              options={[
                { value: "PIECE", label: "Price per piece" },
                { value: "TOTAL", label: "Total for the pieces" },
              ]}
            />
            <Field
              id="buy-price"
              label={`${priceBasis === "PIECE" ? "Price per piece" : "Total for the pieces"} (${currency})`}
              hint={
                figures.count && figures.goods
                  ? priceBasis === "PIECE"
                    ? `Total for ${figures.count} pieces: ${money(figures.goods)}`
                    : `Per piece: ${money(figures.perPiece)}`
                  : "One price for every colour and size"
              }
              error={fieldError("price")}
            >
              <Input
                id="buy-price"
                value={price}
                inputMode="decimal"
                placeholder={priceBasis === "PIECE" ? "30" : "9000"}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Extra costs (on the same bill)</legend>
              {extras.map((e, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2">
                  <div>
                    <Input
                      value={e.label}
                      maxLength={60}
                      aria-label={`Extra cost ${i + 1}: what for`}
                      placeholder="Transport"
                      onChange={(ev) =>
                        setExtras((x) =>
                          x.map((y, j) => (j === i ? { ...y, label: ev.target.value } : y)),
                        )
                      }
                    />
                    {fieldError(`extraCosts.${i}.label`) && (
                      <p className="mt-1 text-sm text-destructive">
                        {fieldError(`extraCosts.${i}.label`)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Input
                      value={e.amount}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Extra cost ${i + 1}: amount`}
                      onChange={(ev) =>
                        setExtras((x) =>
                          x.map((y, j) => (j === i ? { ...y, amount: ev.target.value } : y)),
                        )
                      }
                    />
                    {fieldError(`extraCosts.${i}.amount`) && (
                      <p className="mt-1 text-sm text-destructive">
                        {fieldError(`extraCosts.${i}.amount`)}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove extra cost ${i + 1}`}
                    onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </div>
              ))}
              {extras.length < 10 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => setExtras((x) => [...x, { label: "", amount: "" }])}
                >
                  <PlusIcon aria-hidden />
                  Add a cost
                </Button>
              )}
            </fieldset>
            <dl
              aria-label="Bill"
              className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-5"
            >
              {[
                ["Pieces", String(figures.count)],
                ["Goods", money(figures.goods)],
                ["Extra costs", money(figures.extra)],
                ["Total", money(figures.total)],
                ["Cost per piece", money(figures.costEach)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="grid gap-3" aria-label="Payment">
            {page.canPay ? (
              <>
                <Choices
                  name="payment"
                  legend="Payment"
                  value={payment}
                  onChange={setPayment}
                  options={[
                    { value: "DUE", label: "Due" },
                    { value: "PART", label: "Part paid" },
                    { value: "FULL", label: "Paid in full" },
                  ]}
                />
                {payment === "PART" && (
                  <Field
                    id="buy-paid-now"
                    label={`Paid now (${currency})`}
                    error={fieldError("payment.amount")}
                  >
                    <Input id="buy-paid-now" name="paidNow" inputMode="decimal" />
                  </Field>
                )}
                {payment !== "DUE" && (
                  <PaidFromFields
                    idPrefix="buy-pay"
                    accounts={page.accounts}
                    currency={currency}
                    fieldError={(name) => fieldError(`payment.${name}`)}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Payment: saved as Due. Accounts pays the supplier later.
              </p>
            )}
          </section>

          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="retailOnly"
              className="size-4 cursor-pointer accent-primary"
            />
            Retail only: hold every piece for the shops
          </label>
          <Field id="buy-mode" label="Shops' price" error={fieldError("priceMode")}>
            <NativeSelect
              id="buy-mode"
              value={priceMode}
              onChange={(e) => setPriceMode(e.target.value)}
              containerClassName="sm:w-full"
            >
              <option value="RULE">{PRICE_MODE.RULE}</option>
              <option value="FIXED">{PRICE_MODE.FIXED}</option>
              <option value="AT_COST">{PRICE_MODE.AT_COST}</option>
            </NativeSelect>
          </Field>
          {priceMode === "FIXED" && (
            <Field
              id="buy-fixed"
              label={`Price for the shops (${currency})`}
              error={fieldError("fixedPrice")}
            >
              <Input id="buy-fixed" name="fixedPrice" inputMode="decimal" placeholder="650" />
            </Field>
          )}
          <Field id="buy-note" label="Note (optional)" error={fieldError("note")}>
            <Input id="buy-note" name="note" />
          </Field>
          <PinField id="buy-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
        </>
      )}
    </FormDialog>
  );
}
