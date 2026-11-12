"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { BackLink } from "@/components/settings/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { WholesaleReturnForm as Form } from "@/modules/sales/wholesale-return.service";
import {
  exchangeQuoteAction,
  receiveWholesaleReturnAction,
  searchExchangeSkusAction,
} from "@/server/actions/wholesale-returns.actions";

import { money } from "./labels";

/*
 * "Receive return" (2026-11-12): the pieces of each invoice line that came
 * back, and for each line a required choice, "Refund" or "Exchange". Exchange
 * opens a window: "Size only" (same style and colour) or "Other product", the
 * new SKU and pieces, and the price difference worked out live.
 */

type Exchange = {
  kind: "SIZE" | "OTHER";
  variantId: string;
  sku: string;
  quantity: number;
  difference: string;
};
type Row = { pieces: string; mode: "" | "REFUND" | "EXCHANGE"; exchange: Exchange | null };

export function WholesaleReturnForm({ form }: { form: Form }) {
  const router = useRouter();
  const cur = form.currency;
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      form.lines.map((l) => [l.orderItemId, { pieces: "", mode: "", exchange: null }]),
    ),
  );
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const [exchangeFor, setExchangeFor] = useState<string | null>(null);

  const set = (id: string, change: Partial<Row>) =>
    setRows((all) => ({ ...all, [id]: { ...all[id]!, ...change } }));

  async function submit() {
    setBusy(true);
    setError(null);
    const lines = form.lines
      .filter((l) => Number(rows[l.orderItemId]!.pieces) > 0)
      .map((l) => {
        const row = rows[l.orderItemId]!;
        return {
          orderItemId: l.orderItemId,
          quantity: row.pieces,
          mode: row.mode || undefined,
          ...(row.mode === "EXCHANGE" && row.exchange
            ? {
                exchange: {
                  kind: row.exchange.kind,
                  variantId: row.exchange.variantId,
                  quantity: row.exchange.quantity,
                },
              }
            : {}),
        };
      });
    const result = await receiveWholesaleReturnAction({
      invoiceId: form.invoice.id,
      reason,
      notes: notes || undefined,
      lines,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/sales/wholesale-returns/${result.data.id}`);
  }

  const line = form.lines.find((l) => l.orderItemId === exchangeFor);

  return (
    <div className="grid min-w-0 gap-6">
      <BackLink href="/sales/wholesale-returns/new">Choose another invoice</BackLink>
      <div className="min-w-0">
        <h2 className="font-serif text-2xl text-primary">Receive return</h2>
        <p className="mt-1 text-sm break-words text-muted-foreground">
          {form.invoice.buyer?.name} · invoice {form.invoice.number} · order{" "}
          {form.invoice.order.number}. The pieces go to Returns to check: counted, not sellable
          until the QC.
        </p>
      </div>
      {error && <FormAlert>{error.message}</FormAlert>}

      <ul className="grid gap-3" aria-label="Lines">
        {form.lines.map((l) => {
          const row = rows[l.orderItemId]!;
          return (
            <li
              key={l.orderItemId}
              className="grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-3"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{l.sku}</p>
                <p className="text-sm break-words text-muted-foreground">{l.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {l.delivered} delivered · {l.returned} back already · {l.returnable} can come back
                  · {money(l.priceBilled, cur)} each
                </p>
              </div>
              <Field id={`pieces-${l.orderItemId}`} label="Pieces back">
                <Input
                  id={`pieces-${l.orderItemId}`}
                  inputMode="numeric"
                  value={row.pieces}
                  disabled={l.returnable === 0}
                  onChange={(e) => set(l.orderItemId, { pieces: e.target.value })}
                />
              </Field>
              <div className="grid min-w-0 gap-2">
                <span className="text-sm font-medium">Refund or Exchange</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={row.mode === "REFUND" ? "default" : "outline"}
                    onClick={() => set(l.orderItemId, { mode: "REFUND", exchange: null })}
                  >
                    Refund
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={row.mode === "EXCHANGE" ? "default" : "outline"}
                    onClick={() => setExchangeFor(l.orderItemId)}
                  >
                    Exchange
                  </Button>
                </div>
                {row.mode === "EXCHANGE" && row.exchange && (
                  <p className="text-sm break-words">
                    {row.exchange.quantity} × {row.exchange.sku}: price difference{" "}
                    {money(row.exchange.difference, cur)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Field id="wr-reason" label="Reason">
        <Input id="wr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field id="wr-notes" label="Notes">
        <Textarea id="wr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div>
        <Button type="button" disabled={busy} onClick={submit} className="w-full sm:w-auto">
          {busy ? "Receiving" : "Receive return"}
        </Button>
      </div>

      {line && (
        <ExchangeDialog
          key={line.orderItemId}
          form={form}
          line={line}
          pieces={Number(rows[line.orderItemId]!.pieces) || 0}
          onClose={() => setExchangeFor(null)}
          onDone={(exchange) => {
            set(line.orderItemId, { mode: "EXCHANGE", exchange });
            setExchangeFor(null);
          }}
        />
      )}
    </div>
  );
}

function ExchangeDialog({
  form,
  line,
  pieces,
  onClose,
  onDone,
}: {
  form: Form;
  line: Form["lines"][number];
  pieces: number;
  onClose: () => void;
  onDone: (exchange: Exchange) => void;
}) {
  const cur = form.currency;
  const [kind, setKind] = useState<"SIZE" | "OTHER">("SIZE");
  const [variant, setVariant] = useState<{ id: string; sku: string } | null>(null);
  const [newQuantity, setNewQuantity] = useState(String(pieces || ""));
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Array<{ id: string; sku: string; label: string }>>([]);
  const [quote, setQuote] = useState<{
    difference: string;
    newTotal: string;
    credit: string;
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  async function price(v: { id: string; sku: string } | null, qty: string) {
    setQuote(null);
    setQuoteError(null);
    if (!v || !(Number(qty) > 0) || !(pieces > 0)) return;
    const result = await exchangeQuoteAction({
      invoiceId: form.invoice.id,
      orderItemId: line.orderItemId,
      quantity: pieces,
      variantId: v.id,
      newQuantity: qty,
    });
    if (result.ok) {
      setQuote(result.data);
      if (result.data.short) setQuoteError(`Only ${result.data.available} pcs in stock.`);
    } else setQuoteError(result.error.message);
  }

  return (
    <FormDialog
      title="Exchange"
      description={`${line.sku}: ${pieces > 0 ? `${pieces} pcs back` : "enter the pieces back first"}. Choose the new piece; the price difference is worked out at once.`}
      submitLabel="Use this exchange"
      pendingLabel="Saving"
      errorTitle="The exchange was not set"
      onClose={onClose}
      onSubmit={async () => {
        if (!variant || !quote) {
          return { code: "VALIDATION", message: "Choose the new piece and its pieces." };
        }
        onDone({
          kind,
          variantId: variant.id,
          sku: variant.sku,
          quantity: Number(newQuantity),
          difference: quote.difference,
        });
        return undefined;
      }}
    >
      {() => (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Exchange kind">
            <Button
              type="button"
              size="sm"
              variant={kind === "SIZE" ? "default" : "outline"}
              onClick={() => {
                setKind("SIZE");
                setVariant(null);
                setQuote(null);
              }}
            >
              Size only
            </Button>
            <Button
              type="button"
              size="sm"
              variant={kind === "OTHER" ? "default" : "outline"}
              onClick={() => {
                setKind("OTHER");
                setVariant(null);
                setQuote(null);
              }}
            >
              Other product
            </Button>
          </div>
          {kind === "SIZE" ? (
            <div className="flex flex-wrap gap-2" aria-label="New size">
              {line.sizes.length === 0 && (
                <p className="text-sm text-muted-foreground">No other size of this colour.</p>
              )}
              {line.sizes.map((s) => (
                <Button
                  key={s.id}
                  type="button"
                  size="sm"
                  variant={variant?.id === s.id ? "default" : "outline"}
                  onClick={() => {
                    setVariant(s);
                    void price(s, newQuantity);
                  }}
                >
                  {s.size}
                </Button>
              ))}
            </div>
          ) : (
            <div className="grid gap-2">
              <Field id="ex-search" label="Find the new product">
                <Input
                  id="ex-search"
                  value={search}
                  placeholder="SKU, style or colour"
                  onChange={async (e) => {
                    setSearch(e.target.value);
                    const result = await searchExchangeSkusAction(e.target.value);
                    setFound(result.ok ? result.data : []);
                  }}
                />
              </Field>
              <ul className="grid max-h-48 gap-1 overflow-y-auto">
                {found.map((v) => (
                  <li key={v.id}>
                    <Button
                      type="button"
                      size="sm"
                      variant={variant?.id === v.id ? "default" : "ghost"}
                      className="h-auto w-full justify-start text-left whitespace-normal"
                      onClick={() => {
                        setVariant(v);
                        void price(v, newQuantity);
                      }}
                    >
                      {v.sku} · {v.label}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field id="ex-qty" label="New pieces">
            <Input
              id="ex-qty"
              inputMode="numeric"
              value={newQuantity}
              onChange={(e) => {
                setNewQuantity(e.target.value);
                void price(variant, e.target.value);
              }}
            />
          </Field>
          {quote && (
            <p className="text-sm break-words">
              New pieces {money(quote.newTotal, cur)} less the returned pieces{" "}
              {money(quote.credit, cur)}: price difference{" "}
              <span className="font-medium">{money(quote.difference, cur)}</span>{" "}
              {Number(quote.difference) > 0
                ? "(added to the buyer's due)"
                : Number(quote.difference) < 0
                  ? "(goes to the buyer's credit)"
                  : ""}
            </p>
          )}
          {quoteError && <p className="text-sm text-destructive">{quoteError}</p>}
        </>
      )}
    </FormDialog>
  );
}
