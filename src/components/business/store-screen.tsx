"use client";

import { PencilIcon, PlusIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PinField } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { Field } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Fact, Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { StoreAccount } from "@/modules/retail/account.service";
import type { StoreDashboard as Dashboard } from "@/modules/retail/dashboards.service";
import type { StoreBooks as Books } from "@/modules/retail/summaries.service";
import type { StorePage as StoreData } from "@/modules/retail/stores.service";
import {
  releaseHoldAction,
  removeHandPriceAction,
  setHandPriceAction,
  setPriceRulesAction,
  setStoreClosedAction,
} from "@/server/actions/retail.actions";

import { StoreBooks } from "./store-books";
import { StoreDashboard, StoreHealth } from "./store-dashboard";
import { StorePad } from "./store-pad";
import { StoreFormDialog } from "./store-form-dialog";

/*
 * One retail store (plan v6 sec 2, 4 and 10): its dashboard, its details, its price rules, its hand
 * prices (with a note when the cost changed since), the prices it sees per style,
 * and every price change. Price changes ask for the owner's PIN.
 */

type StorePage = StoreData & {
  account: StoreAccount;
  books: Books;
  dashboard: Dashboard;
  yearReports: Array<{ id: string; year: number }>;
};

type Dialog =
  | { kind: "edit" }
  | { kind: "hold" }
  | { kind: "close" }
  | { kind: "rules" }
  | { kind: "hand" }
  | { kind: "remove"; id: string; label: string };

export function StoreScreen({ page }: { page: StorePage }) {
  const { store, currency } = page;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const when = useWhen({ year: true });
  const close = () => setDialog(null);
  const range = (r: { low: string; high: string } | null) =>
    r === null
      ? "No price"
      : r.low === r.high
        ? `${currency} ${r.low}`
        : `${currency} ${r.low} to ${r.high}`;

  return (
    <div className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href="/business/stores" className="text-sm text-muted-foreground hover:underline">
            Retail stores
          </Link>
          <h2 className="mt-1 font-serif text-2xl break-words text-primary">{store.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge tone={store.closedAt ? "closed" : "done"}>
              {store.closedAt ? "Closed" : "Open"}
            </StatusBadge>
            <span className="text-sm text-muted-foreground">
              {store.kind === "ONLINE" ? "Online" : "Showroom"}
            </span>
          </div>
          <div className="mt-2">
            <StoreHealth
              d={page.dashboard}
              onHold={page.account.onHold}
              missingDays={page.books.missing.length}
            />
          </div>
        </div>
        {page.canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog({ kind: "edit" })}>
              <PencilIcon aria-hidden />
              Edit store
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialog({ kind: "close" })}>
              {store.closedAt ? "Open the store again" : "Close store"}
            </Button>
          </div>
        )}
      </div>

      <StoreDashboard d={page.dashboard} currency={currency} storeId={store.id} />

      <Panel title="Details" id="store-details">
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label="Buyer">
            <Link
              href={`/parties/buyers/${store.buyer.id}`}
              className="text-primary hover:underline"
            >
              {store.buyer.code}: Buyer 360
            </Link>
          </Fact>
          <Fact label="Warehouse">{store.warehouse?.name ?? "None yet"}</Fact>
          <Fact label="Online shop">
            {store.onlineShop ? (
              <Link
                href={`/settings/integrations/ecommerce/${store.onlineShop.id}`}
                className="text-primary hover:underline"
              >
                {store.onlineShop.name} ({store.onlineShop.hasKey ? "has a key" : "no key yet"})
              </Link>
            ) : (
              "None"
            )}
          </Fact>
          <Fact label="Address">{store.address ?? "Not given"}</Fact>
          <Fact label="Phone">{store.phone ?? "Not given"}</Fact>
        </dl>
      </Panel>

      <StorePad
        storeId={store.id}
        logoId={store.logoId}
        yearReports={page.yearReports}
        canManage={page.canManage}
      />

      <AccountPanel page={page} when={when} onLift={() => setDialog({ kind: "hold" })} />

      <StoreBooks
        books={page.books}
        storeId={store.id}
        currency={currency}
        canManage={page.canManage}
      />

      <Panel
        title="Price rules"
        id="store-rules"
        action={
          page.canManage && (
            <Button type="button" size="sm" onClick={() => setDialog({ kind: "rules" })}>
              Change the price rules
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          Every SKU without a hand price is priced by its grade&apos;s rule, from that grade&apos;s
          cost. With no rule or no cost it has no price, and the store is not shown it.
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fact label="A-grade price">{store.aRuleText}</Fact>
          <Fact label="B-grade price">{store.bRuleText}</Fact>
        </dl>
      </Panel>

      <Panel
        title="Hand prices"
        id="store-hand"
        action={
          page.canManage && (
            <Button type="button" size="sm" onClick={() => setDialog({ kind: "hand" })}>
              <PlusIcon aria-hidden />
              Add hand price
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          A hand price wins over the rule: one SKU first, then a style&apos;s colour, then the
          style.
        </p>
        {page.handPrices.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No hand prices.</p>
        ) : (
          <ul className="mt-4 grid gap-3" aria-label="Hand prices">
            {page.handPrices.map((h) => {
              const place = h.sku ?? (h.color ? `${h.styleCode}, ${h.color}` : h.styleCode);
              return (
                <li
                  key={h.id}
                  className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {h.grade}-grade · {place}{" "}
                      <span className="text-muted-foreground">({h.styleName})</span>
                    </p>
                    <p className="text-muted-foreground">
                      {currency} {h.price}
                      {h.costNow !== null &&
                        ` · Cost then ${currency} ${h.costWhenSet}, now ${currency} ${h.costNow}`}
                    </p>
                    {h.costChanged && (
                      <p className="mt-1 flex items-start gap-1.5 text-destructive">
                        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                        Cost changed: look at this price
                      </p>
                    )}
                  </div>
                  {page.canManage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDialog({ kind: "remove", id: h.id, label: `${h.grade}-grade ${place}` })
                      }
                    >
                      <XIcon aria-hidden />
                      Take off
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Prices the store sees" id="store-preview">
        <form className="mt-4 flex flex-col gap-2 sm:flex-row" role="search">
          <Input
            name="search"
            defaultValue={page.search}
            placeholder="Style code or name"
            aria-label="Search styles"
            className="sm:max-w-xs"
          />
          <Button type="submit" variant="outline">
            <SearchIcon aria-hidden />
            Search
          </Button>
        </form>
        {page.styles.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No styles found.</p>
        ) : (
          <ul className="mt-4 grid gap-2" aria-label="Prices by style">
            {page.styles.map((s) => (
              <li key={s.id} className="grid gap-1 rounded-md border p-3 text-sm sm:grid-cols-3">
                <p className="min-w-0 break-words">
                  <span className="font-medium">{s.code}</span> {s.name}{" "}
                  <span className="text-muted-foreground">({s.skus} SKUs)</span>
                </p>
                <p>A-grade: {range(s.a)}</p>
                <p>B-grade: {range(s.b)}</p>
                {s.aMissing > 0 && (
                  <p className="text-destructive sm:col-span-3">
                    {s.aMissing} A-grade SKU(s) not shown to the store: no price
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Price history" id="store-history">
        {page.history.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No price changes yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2 text-sm" aria-label="Price history">
            {page.history.map((h) => (
              <li key={h.id} className="rounded-md border p-3">
                <p className="font-medium break-words">{h.what}</p>
                <p className="break-words text-muted-foreground">
                  Was {h.before ?? "nothing"}, now {h.after ?? "nothing"} · {h.by ?? "Someone"},{" "}
                  {when(h.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {dialog?.kind === "edit" && (
        <StoreFormDialog
          store={store}
          warehouses={page.warehouses}
          onlineShops={page.onlineShops}
          onClose={close}
        />
      )}
      {dialog?.kind === "close" && <CloseDialog page={page} onClose={close} />}
      {dialog?.kind === "hold" && <HoldDialog page={page} onClose={close} />}
      {dialog?.kind === "rules" && <RulesDialog page={page} onClose={close} />}
      {dialog?.kind === "hand" && <HandPriceDialog page={page} onClose={close} />}
      {dialog?.kind === "remove" && (
        <RemoveDialog id={dialog.id} label={dialog.label} storeId={store.id} onClose={close} />
      )}
    </div>
  );
}

/**
 * What the store owes the ERP and its 30-day hold (plan v6 sec 5): with money
 * owed and no payment for 30 days, its new orders are refused until it pays,
 * or the owner lifts the hold for a few days with the PIN and a reason.
 */
function AccountPanel({
  page,
  when,
  onLift,
}: {
  page: StorePage;
  when: ReturnType<typeof useWhen>;
  onLift: () => void;
}) {
  const { account, currency, store } = page;
  const hold = account.onHold
    ? `On hold: ${account.reason}`
    : account.releasedUntil
      ? `Lifted until ${when(account.releasedUntil)}: ${account.releaseReason}`
      : account.holdsOn
        ? `Not on hold. Goes on hold on ${account.holdsOn} if no payment comes`
        : "Not on hold";
  return (
    <Panel
      title="Account"
      id="store-account"
      action={
        page.canManage &&
        account.onHold && (
          <Button type="button" size="sm" variant="outline" onClick={onLift}>
            Lift the hold
          </Button>
        )
      }
    >
      <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Balance">
          {currency} {account.balance}
        </Fact>
        <Fact label="Waiting for check">
          {currency} {account.waitingCheck}
        </Fact>
        <Fact label="Exchanges at risk">
          {currency} {account.exchangesAtRisk}
        </Fact>
        <Fact label="Last payment">{account.lastPaymentAt ?? "None yet"}</Fact>
        <Fact label="Hold">
          <span className={account.onHold ? "text-destructive" : undefined}>{hold}</span>
        </Fact>
        <Fact label="Billed orders">{account.billedOrders}</Fact>
        <Fact label="Statement">
          <Link
            href={`/parties/buyers/${store.buyer.id}/statement`}
            className="text-primary hover:underline"
          >
            Open the statement
          </Link>
        </Fact>
      </dl>
    </Panel>
  );
}

function HoldDialog({ page, onClose }: { page: StorePage; onClose: () => void }) {
  const router = useRouter();
  return (
    <FormDialog
      title="Lift the hold"
      description="The store can send orders again for these days, even though it has not paid. It is saved with your name and the reason."
      submitLabel="Lift it"
      pendingLabel="Saving"
      errorTitle="The hold was not lifted"
      onClose={onClose}
      onSubmit={async (form) => {
        const result = await releaseHoldAction(page.store.id, {
          reason: String(form.get("reason") ?? ""),
          days: String(form.get("days") ?? "7"),
          pin: String(form.get("pin") ?? ""),
        });
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <>
          <Field id="hold-reason" label="Reason" error={fieldError("reason")}>
            <Input id="hold-reason" name="reason" maxLength={300} autoComplete="off" />
          </Field>
          <Field id="hold-days" label="For how many days" error={fieldError("days")}>
            <Input id="hold-days" name="days" type="number" min={1} max={30} defaultValue={7} />
          </Field>
          <PinField id="hold-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
        </>
      )}
    </FormDialog>
  );
}

function CloseDialog({ page, onClose }: { page: StorePage; onClose: () => void }) {
  const router = useRouter();
  const closing = !page.store.closedAt;
  return (
    <FormDialog
      title={closing ? "Close store" : "Open the store again"}
      description={
        closing
          ? "A closed store keeps its whole history: its buyer, account and prices stay."
          : "The store is open again with its prices as they were."
      }
      submitLabel={closing ? "Close the store" : "Open it again"}
      pendingLabel="Saving"
      destructive={closing}
      errorTitle="The store was not changed"
      onClose={onClose}
      onSubmit={async () => {
        const result = await setStoreClosedAction(page.store.id, closing);
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {() => null}
    </FormDialog>
  );
}

function RulesDialog({ page, onClose }: { page: StorePage; onClose: () => void }) {
  const router = useRouter();
  const { store, currency } = page;
  return (
    <FormDialog
      title="Change the price rules"
      description="Each rule prices every SKU of its grade that has no hand price, from that grade's cost."
      submitLabel="Save the rules"
      pendingLabel="Saving"
      errorTitle="The rules were not saved"
      onClose={onClose}
      onSubmit={async (form) => {
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const result = await setPriceRulesAction(store.id, {
          aRule: text("aRule"),
          aValue: text("aValue"),
          bRule: text("bRule"),
          bValue: text("bValue"),
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
          <Field id="rule-a" label="A-grade rule" error={fieldError("aRule")}>
            <NativeSelect
              id="rule-a"
              name="aRule"
              defaultValue={store.aRule ?? "NONE"}
              containerClassName="sm:w-full"
            >
              <option value="NONE">No rule (hand prices only)</option>
              <option value="PERCENT">Cost + a %</option>
              <option value="AMOUNT">Cost + an amount ({currency})</option>
            </NativeSelect>
          </Field>
          <Field id="rule-a-value" label="A-grade number" error={fieldError("aValue")}>
            <Input
              id="rule-a-value"
              name="aValue"
              inputMode="decimal"
              defaultValue={store.aValue ?? ""}
              placeholder="25"
            />
          </Field>
          <Field id="rule-b" label="B-grade rule" error={fieldError("bRule")}>
            <NativeSelect
              id="rule-b"
              name="bRule"
              defaultValue={store.bRule ?? "NONE"}
              containerClassName="sm:w-full"
            >
              <option value="NONE">No rule (hand prices only)</option>
              <option value="PERCENT">B-grade cost + a %</option>
              <option value="AMOUNT">B-grade cost + an amount ({currency})</option>
              <option value="FIXED">One price for every B-grade piece</option>
            </NativeSelect>
          </Field>
          <Field id="rule-b-value" label="B-grade number" error={fieldError("bValue")}>
            <Input
              id="rule-b-value"
              name="bValue"
              inputMode="decimal"
              defaultValue={store.bValue ?? ""}
              placeholder="10"
            />
          </Field>
          <PinField id="rule-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
        </>
      )}
    </FormDialog>
  );
}

function HandPriceDialog({ page, onClose }: { page: StorePage; onClose: () => void }) {
  const router = useRouter();
  const [styleId, setStyleId] = useState(page.styles[0]?.id ?? "");
  const [colorId, setColorId] = useState("");
  const style = page.styles.find((s) => s.id === styleId);
  const sizes = style?.variants.filter((v) => v.colorId === colorId) ?? [];
  return (
    <FormDialog
      title="Add hand price"
      description="It replaces the hand price at the same place, and wins over the rule. Search for a style on the page to find it here."
      submitLabel="Save the price"
      pendingLabel="Saving"
      errorTitle="The price was not saved"
      onClose={onClose}
      onSubmit={async (form) => {
        const text = (name: string) => String(form.get(name) ?? "").trim();
        const result = await setHandPriceAction({
          storeId: page.store.id,
          grade: text("grade"),
          styleId,
          colorId,
          variantId: text("variantId"),
          price: text("price"),
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
          <Field id="hand-grade" label="Grade" error={fieldError("grade")}>
            <NativeSelect
              id="hand-grade"
              name="grade"
              defaultValue="A"
              containerClassName="sm:w-full"
            >
              <option value="A">A-grade</option>
              <option value="B">B-grade</option>
            </NativeSelect>
          </Field>
          <Field id="hand-style" label="Style" error={fieldError("styleId")}>
            <NativeSelect
              id="hand-style"
              value={styleId}
              onChange={(e) => {
                setStyleId(e.target.value);
                setColorId("");
              }}
              containerClassName="sm:w-full"
            >
              {page.styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="hand-color" label="Colour" error={fieldError("colorId")}>
            <NativeSelect
              id="hand-color"
              value={colorId}
              onChange={(e) => setColorId(e.target.value)}
              containerClassName="sm:w-full"
            >
              <option value="">All colours</option>
              {style?.colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {colorId && (
            <Field id="hand-sku" label="SKU" error={fieldError("variantId")}>
              <NativeSelect
                id="hand-sku"
                name="variantId"
                defaultValue=""
                containerClassName="sm:w-full"
              >
                <option value="">All sizes</option>
                {sizes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id="hand-price" label={`Price (${page.currency})`} error={fieldError("price")}>
            <Input id="hand-price" name="price" inputMode="decimal" placeholder="650" />
          </Field>
          <PinField id="hand-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
        </>
      )}
    </FormDialog>
  );
}

function RemoveDialog({
  id,
  label,
  storeId,
  onClose,
}: {
  id: string;
  label: string;
  storeId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <FormDialog
      title="Take off the hand price"
      description={`${label}: the rule prices it again (or it has no price). The change stays in the history.`}
      submitLabel="Take it off"
      pendingLabel="Saving"
      destructive
      errorTitle="The price was not changed"
      onClose={onClose}
      onSubmit={async (form) => {
        const result = await removeHandPriceAction(
          { priceId: id, pin: String(form.get("pin") ?? "").trim() },
          storeId,
        );
        if (!result.ok) return result.error;
        router.refresh();
        onClose();
        return undefined;
      }}
    >
      {(fieldError) => (
        <PinField id="remove-pin" error={fieldError("pin") ?? fieldError("pinNotSet")} />
      )}
    </FormDialog>
  );
}
