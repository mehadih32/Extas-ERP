"use client";

import { PencilIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useWhen } from "@/components/ai/when";
import { Field } from "@/components/forms/field";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ShopStockPage } from "@/modules/retail/shop-stock.service";
import { setReserveAction } from "@/server/actions/retail.actions";

import { BuyReadyStockDialog } from "./buy-ready-stock-dialog";

/*
 * Business > Shop stock (plan v6 sec 3 and 3a): the pieces held for the shops
 * (wholesale cannot sell below it) and ready stock bought for them.
 */

type Reserve = ShopStockPage["reserves"][number];
type Dialog = { kind: "reserve"; reserve?: Reserve } | { kind: "buy" };

const PRICE_MODE: Record<string, string> = {
  RULE: "Shop's own rule",
  FIXED: "One price",
  AT_COST: "At cost",
};

export function ShopStockScreen({ page }: { page: ShopStockPage }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const when = useWhen();
  const close = () => setDialog(null);
  const { currency } = page;

  return (
    <div className="grid gap-6">
      <Panel
        title="Shops' reserve"
        id="shop-reserve"
        action={
          page.canSetReserve && (
            <Button type="button" size="sm" onClick={() => setDialog({ kind: "reserve" })}>
              <PlusIcon aria-hidden />
              Set reserve
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          One reserve for all shops. Wholesale orders cannot take a style&apos;s stock below it, not
          even with Force Allow; the shops can take all of it.
        </p>
        {page.reserves.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing is held for the shops.</p>
        ) : (
          <ul className="mt-4 grid gap-3" aria-label="Shops' reserve">
            {page.reserves.map((r) => (
              <li
                key={r.id}
                className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {r.style} · {r.colour}
                  </p>
                  <p className="text-muted-foreground">
                    Held for shops {r.quantity} · In stock {r.inStock} · Untouched {r.idleDays} days
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                  {r.idle && (
                    <p className="mt-1 flex items-start gap-1.5 text-destructive">
                      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                      60 days without a shop taking any: lower it or keep it
                    </p>
                  )}
                </div>
                {page.canSetReserve && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: "reserve", reserve: r })}
                  >
                    <PencilIcon aria-hidden />
                    Change
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Ready stock bought"
        id="shop-purchases"
        action={
          page.canBuy && (
            <Button type="button" size="sm" onClick={() => setDialog({ kind: "buy" })}>
              <PlusIcon aria-hidden />
              Buy ready stock
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          Finished goods bought from a supplier come into stock at cost, and the supplier&apos;s
          bill is due. Accounts pays it like any other bill.
        </p>
        {page.purchases.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No ready stock bought yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3" aria-label="Ready stock bought">
            {page.purchases.map((p) => (
              <li key={p.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium break-words">
                  {p.number} · {p.style}
                  {p.retailOnly ? " · Retail only" : ""}
                </p>
                <p className="break-words text-muted-foreground">
                  {when(p.date)} · {p.supplier} · Bill {p.bill}
                  {p.supplierRef ? ` (${p.supplierRef})` : ""} · {p.warehouse} · Shops&apos; price:{" "}
                  {PRICE_MODE[p.priceMode]}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <Fact label="Pieces bought">{p.pieces}</Fact>
                  <Fact label="To the shops">{p.toShops}</Fact>
                  <Fact label="Left in stock">{p.left}</Fact>
                  {p.total !== undefined && (
                    <>
                      <Fact label="Bill total">
                        {currency} {p.total}
                      </Fact>
                      <Fact label="Still due">
                        {currency} {p.due}
                      </Fact>
                      <Fact label="Profit on shop sales">
                        {currency} {p.profit}
                      </Fact>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {dialog?.kind === "reserve" && (
        <ReserveDialog page={page} reserve={dialog.reserve} onClose={close} />
      )}
      {dialog?.kind === "buy" && <BuyReadyStockDialog page={page} onClose={close} />}
    </div>
  );
}

function ReserveDialog({
  page,
  reserve,
  onClose,
}: {
  page: ShopStockPage;
  reserve?: Reserve;
  onClose: () => void;
}) {
  const router = useRouter();
  const [styleId, setStyleId] = useState(reserve?.styleId ?? page.styles[0]?.id ?? "");
  const style = page.styles.find((s) => s.id === styleId);
  return (
    <FormDialog
      title={reserve ? "Change the reserve" : "Set reserve"}
      description="The pieces held for the shops. 0 takes the reserve off."
      submitLabel="Save the reserve"
      pendingLabel="Saving"
      errorTitle="The reserve was not saved"
      onClose={onClose}
      onSubmit={async (form) => {
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const result = await setReserveAction({
          styleId,
          colorId: reserve ? (reserve.colorId ?? "") : text("colorId"),
          quantity: text("quantity"),
          note: text("note"),
        });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Field id="reserve-style" label="Style" error={fieldError("styleId")}>
            <NativeSelect
              id="reserve-style"
              value={styleId}
              disabled={reserve !== undefined}
              onChange={(e) => setStyleId(e.target.value)}
              containerClassName="sm:w-full"
            >
              {page.styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="reserve-colour" label="Colour" error={fieldError("colorId")}>
            <NativeSelect
              id="reserve-colour"
              name="colorId"
              defaultValue={reserve?.colorId ?? ""}
              disabled={reserve !== undefined}
              containerClassName="sm:w-full"
            >
              <option value="">All colours</option>
              {style?.colours.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="reserve-quantity" label="Pieces held" error={fieldError("quantity")}>
            <Input
              id="reserve-quantity"
              name="quantity"
              inputMode="numeric"
              defaultValue={reserve?.quantity ?? ""}
              placeholder="100"
            />
          </Field>
          <Field id="reserve-note" label="Note (optional)" error={fieldError("note")}>
            <Input id="reserve-note" name="note" defaultValue={reserve?.note ?? ""} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
