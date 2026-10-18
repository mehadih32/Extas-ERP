"use client";

import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { UNIT_LABELS } from "@/components/materials/labels";
import { Field } from "@/components/forms/field";
import { ProductionStylePicker } from "@/components/production/pickers";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import { CM_PER_LABELS, FABRIC_UNIT_LABELS, pastCmTerms } from "@/modules/costing/costing-labels";
import type { CostingScreen, FabricPrices } from "@/modules/costing/costing.service";
import {
  fabricPricesAction,
  removeCostingStyleAction,
  saveCostingStyleAction,
} from "@/server/actions/costing.actions";

/*
 * The styles on a costing sheet, costed per dozen: fabric (consumption × the
 * supplier's price per kg, per yard for wovens), trims, print, embroidery and
 * wash, other costs, and the CM fixed with the factory. No office overhead.
 * Each shows its cost a piece, the price that leaves the owner's profit % and
 * the profit the buyer's price leaves.
 */

type Style = CostingScreen["styles"][number];

const fmt = (n: number, places = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
const amountOf = (n: number | null, currency: string) =>
  n === null ? "Not given" : `${currency} ${fmt(n)}`;
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

export function StylesPanel({ screen }: { screen: CostingScreen }) {
  const [editing, setEditing] = useState<Style | "new" | null>(null);
  const [removing, setRemoving] = useState<Style | null>(null);
  const { styles, sheet, currency, can } = screen;

  return (
    <Panel
      title="Styles"
      id="costing-styles-heading"
      action={
        can.manage ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing("new")}>
            <PlusIcon aria-hidden />
            Add a style
          </Button>
        ) : null
      }
    >
      <p className="mt-1 text-sm text-muted-foreground">
        Costs per dozen in {currency}. No office overhead; the CM is the price fixed with the
        factory for each style.
      </p>
      {styles.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No style yet. Add each style with its pieces, fabric, trims and CM.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {styles.map((s) => (
            <li key={s.id} className="rounded-md border p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {s.styleRef}
                    {s.style && s.style.code !== s.styleRef ? ` (${s.style.code})` : ""}
                  </p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {s.quantity.toLocaleString("en-US")} pieces
                    {s.description ? ` · ${s.description}` : ""}
                  </p>
                </div>
                {can.manage && (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Change ${s.styleRef}`}
                      onClick={() => setEditing(s)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Take ${s.styleRef} off the sheet`}
                      onClick={() => setRemoving(s)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Part label="Fabric">
                  {s.cost.fabric === null ? "Missing" : fmt(s.cost.fabric)}
                  {s.consumption !== null && s.fabricPrice !== null && (
                    <span className="block text-[0.75rem] text-muted-foreground">
                      {s.consumption} {FABRIC_UNIT_LABELS[s.fabricUnit]} × {fmt(s.fabricPrice)}
                    </span>
                  )}
                </Part>
                <Part label="CM">
                  {s.cost.cm === null ? "Missing" : fmt(s.cost.cm)}
                  {s.cmAmount !== null && (
                    <span className="block text-[0.75rem] text-muted-foreground">
                      {fmt(s.cmAmount)} {CM_PER_LABELS[s.cmPer]}
                    </span>
                  )}
                </Part>
                <Part label="Trims">{fmt(s.cost.trims)}</Part>
                <Part label="Print, embroidery, wash">{fmt(s.cost.valueAdd)}</Part>
                <Part label="Other">{fmt(s.cost.other)}</Part>
                <Part label="Cost a dozen">
                  <span className="font-medium">{fmt(s.cost.direct)}</span>
                </Part>
              </dl>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm sm:grid-cols-4">
                <Part label="Cost a piece">{fmt(s.cost.costPerPiece)}</Part>
                <Part label="Price at your profit">
                  {s.cost.priceAtProfit === null
                    ? screen.profitPercent === null
                      ? "Set the profit %"
                      : "Not possible"
                    : fmt(s.cost.priceAtProfit)}
                </Part>
                <Part label="Buyer's price">
                  {s.buyerPrice === null ? "Not given" : fmt(s.buyerPrice)}
                </Part>
                <Part label="Profit at the buyer's price">
                  {s.cost.buyerProfit === null ? "–" : pct(s.cost.buyerProfit)}
                </Part>
              </dl>
              {s.cost.missing.length > 0 && (
                <p className="mt-3 text-[0.8125rem] text-amber-700 dark:text-amber-400">
                  Still missing: {s.cost.missing.join(", ")}. The cost is too low until it is given.
                </p>
              )}
              {s.quote && (
                <p className="mt-2 text-[0.75rem] text-muted-foreground">
                  Fabric from {s.quote.supplier}&apos;s quote of {formatDay(s.quote.quotedOn)}:{" "}
                  {s.quote.currency} {fmt(s.quote.price)} per {FABRIC_UNIT_LABELS[s.quote.unit]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-5">
        <Part label="Pieces">{sheet.pieces.toLocaleString("en-US")}</Part>
        <Part label="Cost">{amountOf(sheet.cost, currency)}</Part>
        <Part label="At the buyer's price">{amountOf(sheet.valueAtBuyerPrice, currency)}</Part>
        <Part label="Profit at the buyer's price">
          {amountOf(sheet.profitAtBuyerPrice, currency)}
        </Part>
        <Part label="At your profit %">
          {sheet.valueAtProfit === null
            ? screen.profitPercent === null
              ? "Set the profit %"
              : "Not given"
            : amountOf(sheet.valueAtProfit, currency)}
        </Part>
      </dl>

      {editing && (
        <StyleDialog
          screen={screen}
          style={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Take ${removing.styleRef} off the sheet?`}
          description="Its costs are taken off this costing sheet. Nothing else changes."
          confirmLabel="Take off"
          pendingLabel="Taking off"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const result = await removeCostingStyleAction(screen.id, removing.id);
            if (!result.ok) return result.error;
            setRemoving(null);
          }}
        />
      )}
    </Panel>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
      <dd className="break-words tabular-nums">{children}</dd>
    </div>
  );
}

const asText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function StyleDialog({
  screen,
  style,
  onClose,
}: {
  screen: CostingScreen;
  style: Style | null;
  onClose: () => void;
}) {
  const { currency, companyCurrency, exchangeRate } = screen;
  const [picked, setPicked] = useState(style?.style ?? null);
  const [styleRef, setStyleRef] = useState(style?.styleRef ?? "");
  const [fabricName, setFabricName] = useState(style?.fabricName ?? "");
  const [fabricUnit, setFabricUnit] = useState<"KG" | "YARD">(style?.fabricUnit ?? "KG");
  const [fabricPrice, setFabricPrice] = useState(asText(style?.fabricPrice));
  const [quoteId, setQuoteId] = useState(style?.fabricQuoteId ?? "");
  const [cmAmount, setCmAmount] = useState(asText(style?.cmAmount));
  const [cmPer, setCmPer] = useState<"PIECE" | "DOZEN">(style?.cmPer ?? "PIECE");

  /** A price in another currency, in the sheet's; null when it cannot be turned. */
  const inSheet = (price: number, from: string) => {
    if (from === currency) return price;
    if (from === companyCurrency && exchangeRate) return Number((price / exchangeRate).toFixed(4));
    return null;
  };
  const cmHints = screen.hints.cm.filter((h) => !picked || h.styleId === picked.id || !h.styleId);

  return (
    <FormDialog
      title={style ? `Change ${style.styleRef}` : "Add a style"}
      description="Per dozen, in the sheet's currency. Leave a part empty if you do not know it yet."
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="We could not save the style"
      className="sm:max-w-3xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const input: Record<string, string> = {};
        form.forEach((value, key) => {
          if (typeof value === "string") input[key] = value;
        });
        const result = await saveCostingStyleAction(screen.id, style?.id ?? null, input);
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="cs-style"
              label="Style in the app"
              hint="Optional: links past CM and the tech pack."
              error={fieldError("styleId")}
            >
              <input type="hidden" name="styleId" value={picked?.id ?? ""} />
              <ProductionStylePicker
                id="cs-style"
                value={picked}
                onChange={(s) => {
                  setPicked(s);
                  if (s && !styleRef) setStyleRef(s.code);
                }}
              />
            </Field>
            <Field id="cs-ref" label="Style or buyer's reference" error={fieldError("styleRef")}>
              <Input
                id="cs-ref"
                name="styleRef"
                value={styleRef}
                onChange={(e) => setStyleRef(e.target.value)}
                required
              />
            </Field>
            <Field id="cs-description" label="Description" error={fieldError("description")}>
              <Input
                id="cs-description"
                name="description"
                defaultValue={style?.description ?? ""}
                placeholder="e.g. Pique polo, 220 GSM"
              />
            </Field>
            <Field id="cs-quantity" label="Pieces" error={fieldError("quantity")}>
              <Input
                id="cs-quantity"
                name="quantity"
                inputMode="numeric"
                defaultValue={style?.quantity ?? ""}
                required
              />
            </Field>
          </div>

          <fieldset className="grid gap-4 rounded-md border p-3 sm:p-4">
            <legend className="px-1 text-sm font-medium">Fabric</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cs-fabric" label="Fabric" error={fieldError("fabricName")}>
                <Input
                  id="cs-fabric"
                  name="fabricName"
                  value={fabricName}
                  onChange={(e) => setFabricName(e.target.value)}
                  placeholder="e.g. 100% cotton pique 220 GSM"
                />
              </Field>
              <Field id="cs-unit" label="Priced per" error={fieldError("fabricUnit")}>
                <NativeSelect
                  id="cs-unit"
                  name="fabricUnit"
                  value={fabricUnit}
                  onChange={(e) => setFabricUnit(e.target.value as "KG" | "YARD")}
                >
                  <option value="KG">kg (knits)</option>
                  <option value="YARD">yard (wovens)</option>
                </NativeSelect>
              </Field>
              <Field
                id="cs-consumption"
                label={`Fabric a dozen (${FABRIC_UNIT_LABELS[fabricUnit]})`}
                error={fieldError("consumption")}
              >
                <Input
                  id="cs-consumption"
                  name="consumption"
                  inputMode="decimal"
                  defaultValue={asText(style?.consumption)}
                />
              </Field>
              <Field
                id="cs-fabric-price"
                label={`Supplier's price per ${FABRIC_UNIT_LABELS[fabricUnit]} (${currency})`}
                hint={quoteId ? "From a supplier's quote." : undefined}
                error={fieldError("fabricPrice") ?? fieldError("fabricQuoteId")}
              >
                <input type="hidden" name="fabricQuoteId" value={quoteId} />
                <Input
                  id="cs-fabric-price"
                  name="fabricPrice"
                  inputMode="decimal"
                  value={fabricPrice}
                  onChange={(e) => {
                    setFabricPrice(e.target.value);
                    setQuoteId("");
                  }}
                />
              </Field>
            </div>
            <FabricLookup
              initial={fabricName}
              currency={currency}
              toSheet={inSheet}
              onUse={(use) => {
                setFabricPrice(String(use.price));
                setFabricUnit(use.unit);
                setQuoteId(use.quoteId ?? "");
                if (!fabricName) setFabricName(use.fabric);
              }}
            />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="cs-trims"
              className="content-start"
              label="Trims a dozen"
              hint="Buttons, labels, thread, poly, carton."
              error={fieldError("trimsPerDozen")}
            >
              <Input
                id="cs-trims"
                name="trimsPerDozen"
                inputMode="decimal"
                defaultValue={style?.trimsPerDozen ?? 0}
              />
            </Field>
            <Field
              id="cs-value-add"
              className="content-start"
              label="Print, embroidery, wash a dozen"
              error={fieldError("valueAddPerDozen")}
            >
              <Input
                id="cs-value-add"
                name="valueAddPerDozen"
                inputMode="decimal"
                defaultValue={style?.valueAddPerDozen ?? 0}
              />
            </Field>
            <Field
              id="cs-other"
              className="content-start"
              label="Other a dozen"
              hint="Testing, transport, samples."
              error={fieldError("otherPerDozen")}
            >
              <Input
                id="cs-other"
                name="otherPerDozen"
                inputMode="decimal"
                defaultValue={style?.otherPerDozen ?? 0}
              />
            </Field>
          </div>

          <fieldset className="grid gap-4 rounded-md border p-3 sm:p-4">
            <legend className="px-1 text-sm font-medium">CM fixed with the factory</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cs-cm" label={`CM (${currency})`} error={fieldError("cmAmount")}>
                <Input
                  id="cs-cm"
                  name="cmAmount"
                  inputMode="decimal"
                  value={cmAmount}
                  onChange={(e) => setCmAmount(e.target.value)}
                />
              </Field>
              <Field id="cs-cm-per" label="CM is" error={fieldError("cmPer")}>
                <NativeSelect
                  id="cs-cm-per"
                  name="cmPer"
                  value={cmPer}
                  onChange={(e) => setCmPer(e.target.value as "PIECE" | "DOZEN")}
                >
                  <option value="PIECE">per piece</option>
                  <option value="DOZEN">per dozen</option>
                </NativeSelect>
              </Field>
            </div>
            {cmHints.length > 0 && (
              <div className="text-[0.8125rem]">
                <p className="text-muted-foreground">CM agreed before, to compare:</p>
                <ul className="mt-1 grid gap-1">
                  {cmHints.slice(0, 5).map((h) => {
                    const terms = pastCmTerms(h);
                    const value = inSheet(terms.amount, companyCurrency);
                    return (
                      <li key={h.project} className="flex flex-wrap items-center gap-x-2">
                        <span>
                          {h.project}
                          {h.style ? ` · ${h.style}` : ""}
                          {h.factory ? ` · ${h.factory}` : ""}: {companyCurrency}{" "}
                          {fmt(terms.amount)} {CM_PER_LABELS[terms.per]}
                        </span>
                        {value !== null && (
                          <Button
                            type="button"
                            size="sm"
                            variant="link"
                            className="h-auto p-0"
                            onClick={() => {
                              setCmAmount(String(value));
                              setCmPer(terms.per);
                            }}
                          >
                            Use
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </fieldset>

          <Field
            id="cs-buyer-price"
            label={`Buyer's price a piece (${currency})`}
            hint="What the buyer offers or what you quote. The Order check card compares it with the cost."
            error={fieldError("buyerPrice")}
          >
            <Input
              id="cs-buyer-price"
              name="buyerPrice"
              inputMode="decimal"
              defaultValue={asText(style?.buyerPrice)}
            />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

type Use = { price: number; unit: "KG" | "YARD"; quoteId: string | null; fabric: string };

/** Several suppliers' quotes and past booking prices for a fabric, side by side. */
function FabricLookup({
  initial,
  currency,
  toSheet,
  onUse,
}: {
  initial: string;
  currency: string;
  toSheet: (price: number, from: string) => number | null;
  onUse: (use: Use) => void;
}) {
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<FabricPrices | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const look = () =>
    startTransition(async () => {
      // An empty box looks up the fabric typed above.
      const result = await fabricPricesAction({ search: search.trim() || initial.trim() });
      if (!result.ok) {
        setProblem(result.error.message);
        setFound(null);
        return;
      }
      setProblem(null);
      setFound(result.data);
    });

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <label htmlFor="cs-fabric-search" className="sr-only">
          Find fabric prices
        </label>
        <Input
          id="cs-fabric-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              look();
            }
          }}
          placeholder={initial ? `Find prices for ${initial}` : "A word of the fabric, e.g. pique"}
          className="min-w-0"
        />
        <Button type="button" variant="outline" onClick={look} disabled={pending}>
          <SearchIcon aria-hidden />
          Fabric prices
        </Button>
      </div>
      {problem && <p className="text-[0.8125rem] text-destructive">{problem}</p>}
      {found && (
        <div className="grid gap-3 text-[0.8125rem] sm:grid-cols-2">
          <div>
            <p className="font-medium">Supplier quotes</p>
            {found.quotes.length === 0 ? (
              <p className="text-muted-foreground">No quote found.</p>
            ) : (
              <ul className="mt-1 grid gap-1.5">
                {found.quotes.map((q) => {
                  const value = toSheet(q.price, q.currency);
                  return (
                    <li key={q.id} className="rounded border p-2">
                      <p>
                        {q.supplier}: {q.currency} {fmt(q.price)} per {FABRIC_UNIT_LABELS[q.unit]}
                      </p>
                      <p className="text-muted-foreground">
                        {q.fabric} · {formatDay(q.quotedOn)}
                        {q.expired ? " · ended" : ""}
                      </p>
                      {value !== null ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="link"
                          className="h-auto p-0"
                          onClick={() =>
                            onUse({ price: value, unit: q.unit, quoteId: q.id, fabric: q.fabric })
                          }
                        >
                          Use {currency} {fmt(value, 4)}
                        </Button>
                      ) : (
                        <p className="text-muted-foreground">
                          In {q.currency}: give the exchange rate on the sheet to use it.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="font-medium">Paid on past bookings</p>
            {found.past.length === 0 ? (
              <p className="text-muted-foreground">No past booking found.</p>
            ) : (
              <ul className="mt-1 grid gap-1.5">
                {found.past.map((p, i) => {
                  const unit = p.unit === "KG" || p.unit === "YARD" ? p.unit : null;
                  const value = unit ? toSheet(p.price, p.currency) : null;
                  return (
                    <li key={`${p.number}-${i}`} className="rounded border p-2">
                      <p>
                        {p.supplier}: {p.currency} {fmt(p.price)} per{" "}
                        {UNIT_LABELS[p.unit].toLowerCase()}
                      </p>
                      <p className="text-muted-foreground">
                        {p.fabric} · {p.number} · {formatDay(p.on)}
                      </p>
                      {value !== null && unit && (
                        <Button
                          type="button"
                          size="sm"
                          variant="link"
                          className="h-auto p-0"
                          onClick={() =>
                            onUse({ price: value, unit, quoteId: null, fabric: p.fabric })
                          }
                        >
                          Use {currency} {fmt(value, 4)}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
