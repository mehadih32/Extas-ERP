"use client";

import type { PaymentMethod, SalesChannel } from "@prisma/client";
import { CircleCheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { toast } from "@/components/feedback/toaster";
import { Field, FormAlert } from "@/components/forms/field";
import { AMOUNT_HINT, readAmount } from "@/components/products/form-values";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { OrderForm as OrderFormData, SaleMatrix } from "@/modules/sales/screens.service";
import {
  checkBuyerCreditAction,
  convertProformaToOrderAction,
  createOrderAction,
  getBuyerMoneyAction,
  getSaleMatrixAction,
  updateOrderAction,
} from "@/server/actions/sales.actions";

import {
  CHANNEL_HINTS,
  CHANNEL_LABELS,
  METHOD_LABELS,
  money,
  salesHref,
  usesWholesalePrice,
} from "./labels";
import { type Block, blockPieces, fixed2, StyleCard, wholeNumber } from "./order-style-card";
import { BuyerPicker, StylePicker } from "./pickers";
import { ProofDrop, type ReadyProof, uploadProof } from "./proof";
import { ChequeFields } from "./receive-payment-dialog";

type Buyer = { id: string; code: string; name: string };

/** The buyer's credit, checked on the last step the same way saving checks it. */
type Credit = { state: "idle" | "checking" | "ok" } | { state: "refused"; message: string };
/** The server's answer for one buyer and amount. */
type CreditAnswer = { key: string } & Credit;
/** What the chosen buyer already owes and their unused credit, for checkout. */
type BuyerMoney = {
  key: string;
  previousDue: number;
  credit: number;
  /** Owed but on no invoice (an opening balance): money above the bill pays it first. */
  earlier: number;
};

const LOAD_FAILED = "The style could not load. Check the connection and try again.";

const STEPS = ["Customer", "Products", "Charges & delivery", "Review & place"] as const;
const LAST = STEPS.length - 1;

/** Which step each field is on, to go back to the first one with a problem. */
function stepOf(field: string): number {
  const [head = ""] = field.split(".");
  if (
    [
      "channel",
      "partyId",
      "orderDate",
      "shipmentDate",
      "warehouseId",
      "customerName",
      "customerPhone",
      "shippingAddress",
    ].includes(head)
  ) {
    return 0;
  }
  if (["lines", "matrix", "price", "qty"].includes(head)) return 1;
  if (["discount", "shippingCharge", "tax", "totalCartons", "packedById", "notes"].includes(head)) {
    return 2;
  }
  return LAST;
}

// Styles added in the browser get keys from this counter; the ones the page
// starts with are keyed by position, so the server and the browser agree.
let nextKey = 0;
const newKey = () => `style-${++nextKey}`;

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

/** The steps as a numbered strip; earlier steps can be opened again. */
function Steps({ step, onGo }: { step: number; onGo: (step: number) => void }) {
  return (
    <nav aria-label="Order steps">
      <p className="text-[0.8125rem] text-muted-foreground sm:hidden">
        Step {step + 1} of {STEPS.length} · <span className="text-foreground">{STEPS[step]}</span>
      </p>
      <ol className="mt-2 grid grid-cols-4 gap-1.5 sm:mt-0 sm:gap-3">
        {STEPS.map((label, index) => {
          const done = index < step;
          return (
            <li key={label} className="min-w-0">
              <button
                type="button"
                onClick={() => done && onGo(index)}
                disabled={!done}
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  "grid w-full gap-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  done ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn("h-1.5 rounded-full", index <= step ? "bg-primary" : "bg-muted")}
                  aria-hidden
                />
                <span
                  className={cn(
                    "hidden truncate text-[0.8125rem] sm:block",
                    index === step ? "font-medium text-primary" : "text-muted-foreground",
                  )}
                >
                  {index + 1}. {label}
                </span>
                <span className="sr-only sm:hidden">
                  {index + 1}. {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The order form as four short steps (blueprint checkout): 1 the channel and
 * buyer (or walk-in customer), days and warehouse; 2 the styles, each a card
 * with its colour × size grid, the pieces ready (0 in bold red) and Magic Ratio;
 * 3 the discount and charges, cartons and who packed; 4 a review with the
 * buyer's credit check, the documents to make and money taken at checkout.
 * Selling beyond stock asks for Force Allow in a pop-up, offered only to people
 * who hold it. Used for new orders, for editing one before anything leaves the
 * warehouse, and for making the order from a proforma.
 */
export function OrderForm({ form: data }: { form: OrderFormData }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const editing = data.order;
  const proforma = data.proforma;
  const currency = data.currency;
  const defaultWarehouse =
    editing?.warehouseId ??
    data.warehouses.find((w) => w.isDefault)?.id ??
    data.warehouses[0]?.id ??
    "";

  const [step, setStep] = useState(0);
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
  // One style card is open at a time; the others fold to their totals.
  const [openKey, setOpenKey] = useState<string | null>(() =>
    editing?.styles.length || proforma?.styleIds.length ? "start-0" : null,
  );
  const [discount, setDiscount] = useState(
    editing && Number(editing.discount) ? editing.discount : "",
  );
  const [shipping, setShipping] = useState(
    editing && Number(editing.shippingCharge) ? editing.shippingCharge : "",
  );
  const [tax, setTax] = useState(editing && Number(editing.tax) ? editing.tax : "");
  const [cartons, setCartons] = useState(
    editing?.totalCartons != null ? String(editing.totalCartons) : "",
  );
  const [packedById, setPackedById] = useState(editing?.packedById ?? "");
  const [documents, setDocuments] = useState({
    invoice: true,
    packingList: false,
    deliveryChallan: false,
  });
  const [takePayment, setTakePayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [proof, setProof] = useState<ReadyProof | null>(null);
  const [includePrevious, setIncludePrevious] = useState(false);
  const [creditText, setCreditText] = useState("");
  const [buyerMoney, setBuyerMoney] = useState<BuyerMoney>();
  const [forceAllow, setForceAllow] = useState(false);
  const [serverShort, setServerShort] = useState<Record<string, string>>({});
  const [creditAnswer, setCreditAnswer] = useState<CreditAnswer>();
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
      void getSaleMatrixAction(styleId, warehouse ?? undefined)
        .catch(() => ({ ok: false as const, error: { message: LOAD_FAILED } }))
        .then((result) => {
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
    const result = await getSaleMatrixAction(styleId, warehouse || undefined).catch(() => ({
      ok: false as const,
      error: { code: "INTERNAL" as const, message: LOAD_FAILED },
    }));
    if (!result.ok) toast.error(result.error.message);
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
  const beforeDiscount = subtotal + charge(shipping) + charge(tax);
  const total = Math.max(beforeDiscount - charge(discount), 0);
  const paidBefore = editing ? Number(editing.paid) : proforma ? Number(proforma.advancePaid) : 0;
  const payNow = takePayment ? charge(paymentAmount) : 0;
  const isCheque = takePayment && paymentMethod === "CHEQUE";

  // The buyer's previous due and credit (advance balance), read once on the last step
  // when the invoice is issued with the order.
  const moneyKey =
    !locked &&
    step === LAST &&
    buyer &&
    documents.invoice &&
    (data.can.previousDue || data.can.useCredit)
      ? buyer.id
      : "";
  const owed = moneyKey && buyerMoney?.key === moneyKey ? buyerMoney : null;
  useEffect(() => {
    if (!moneyKey) return;
    let live = true;
    void getBuyerMoneyAction(moneyKey)
      .then((result) => {
        if (!live) return;
        setBuyerMoney(
          result.ok
            ? {
                key: moneyKey,
                previousDue: Number(result.data.previousDue),
                credit: Number(result.data.credit),
                earlier: Math.max(
                  Number(result.data.previousDue) - Number(result.data.openDues),
                  0,
                ),
              }
            : { key: moneyKey, previousDue: 0, credit: 0, earlier: 0 },
        );
      })
      .catch(() => {
        // Without the figures checkout works as before: no previous due, no credit.
        if (live) setBuyerMoney({ key: moneyKey, previousDue: 0, credit: 0, earlier: 0 });
      });
    return () => {
      live = false;
    };
  }, [moneyKey]);
  const canIncludePrevious = Boolean(data.can.previousDue && owed && owed.previousDue > 0);
  const withPrevious = canIncludePrevious && includePrevious;
  const canUseCredit = Boolean(data.can.useCredit && owed && owed.credit > 0);
  const creditUse = canUseCredit ? charge(creditText) : 0;
  /** Left to pay on this order after the credit used. */
  const afterCredit = Math.max(total - creditUse, 0);
  // Above the order the money goes on the buyer's account: only with the invoice and a buyer,
  // and never a cheque (it is not in the books until it clears).
  const extraAllowed = !locked && documents.invoice && Boolean(buyer) && !isCheque;
  const extra = takePayment && !isCheque ? Math.max(payNow - afterCredit, 0) : 0;
  /** The previous due as printed: credit the buyer had was taken off it, and goes back on when used. */
  const previousShown = withPrevious ? owed!.previousDue + creditUse : 0;
  /** What is left to pay after this checkout (below zero: kept on the buyer's account). */
  const balanceAfter = total + previousShown - creditUse - (isCheque ? 0 : payNow);
  /** The total box spells out the money lines when the bill goes beyond this order. */
  const accountLines = withPrevious || creditUse > 0 || extra > 0;
  /** Kept as advance balance: with the previous due, what the buyer is ahead by after this. */
  const keptAfter = withPrevious
    ? Math.max(-balanceAfter, 0)
    : Math.max(extra - (owed?.earlier ?? 0), 0);

  const short = { ...shortSkus(blocks, own), ...serverShort };
  const shortCount = Object.keys(short).length;
  /** What the buyer takes on credit with this order, as the server will check it. */
  const creditAmount = editing
    ? Math.max(total - Number(editing.total), 0)
    : proforma
      ? total
      : Math.max(total - payNow - creditUse, 0);

  // On the last step, the buyer's credit limit is checked like saving checks it.
  const creditFixed = fixed2(creditAmount);
  const creditKey = step === LAST && buyer && creditAmount > 0 ? `${buyer.id}:${creditFixed}` : "";
  const credit: Credit = !creditKey
    ? { state: "idle" }
    : creditAnswer?.key === creditKey
      ? creditAnswer
      : { state: "checking" };
  useEffect(() => {
    if (!creditKey) return;
    const [partyId] = creditKey.split(":");
    let live = true;
    const timer = setTimeout(() => {
      void checkBuyerCreditAction({ partyId: partyId!, amount: Number(creditFixed) })
        .then((result) => {
          if (!live) return;
          setCreditAnswer(
            result.ok
              ? { key: creditKey, state: "ok" }
              : { key: creditKey, state: "refused", message: result.error.message },
          );
        })
        .catch(() => {
          // A lost connection does not block placing: saving checks the limit again.
          if (live) setCreditAnswer({ key: creditKey, state: "idle" });
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [creditKey, creditFixed]);

  /** Rounds the total down to a whole `unit` by setting the discount. */
  function roundOff(unit: number) {
    const target = Math.floor(beforeDiscount / unit) * unit;
    setDiscount(beforeDiscount - target > 0 ? fixed2(beforeDiscount - target) : "");
  }

  /** The problems on one step, found before asking the server. */
  function problemsOn(index: number, form: FormData): Record<string, string> {
    const text = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    const found: Record<string, string> = {};
    if (index === 0) {
      if (buyerNeeded && !buyer) found.partyId = "Choose the buyer.";
      const orderDate = text("orderDate");
      const shipmentDate = text("shipmentDate");
      if (shipmentDate && shipmentDate < (orderDate || data.today)) {
        found.shipmentDate = "Choose a day on or after the order date.";
      }
    }
    if (index === 1) {
      if (pieces < 1) found.lines = "Add a style and enter the pieces.";
      blocks.forEach((block) => {
        if (readAmount(block.unitPrice) === "invalid") found[`price.${block.key}`] = AMOUNT_HINT;
        for (const [variantId, q] of Object.entries(block.quantities)) {
          if (q.trim() && wholeNumber(q) === null) found[`qty.${variantId}`] = "Whole pieces";
        }
      });
    }
    if (index === 2) {
      for (const [name, value] of [
        ["discount", discount],
        ["shippingCharge", shipping],
        ["tax", tax],
      ] as const) {
        if (readAmount(value) === "invalid") found[name] = AMOUNT_HINT;
      }
      if (charge(discount) > beforeDiscount + 0.001) {
        found.discount = `At most ${fixed2(beforeDiscount)}.`;
      }
      if (cartons.trim() && wholeNumber(cartons) === null) found.totalCartons = "Whole cartons";
    }
    if (index === LAST && canUseCredit) {
      const used = readAmount(creditText);
      if (used === "invalid") found.useCredit = AMOUNT_HINT;
      else if (used !== null && used > Math.min(owed!.credit, total) + 0.001) {
        found.useCredit = `At most ${fixed2(Math.min(owed!.credit, total))}.`;
      }
    }
    if (index === LAST && takePayment) {
      const amount = readAmount(paymentAmount);
      if (amount === "invalid") found["payment.amount"] = AMOUNT_HINT;
      else if (amount === null || amount <= 0) found["payment.amount"] = "Enter the amount paid.";
      else if (!extraAllowed && amount > afterCredit + 0.001) {
        found["payment.amount"] = `At most ${fixed2(afterCredit)}.`;
      }
      if (isCheque && !text("chequeNo"))
        found["payment.cheque.chequeNo"] = "Enter the cheque number.";
    }
    return found;
  }

  function go(next: number) {
    setStep(next);
    formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function next() {
    const found = problemsOn(step, new FormData(formRef.current!));
    setProblems(found);
    if (Object.keys(found).length === 0) go(step + 1);
  }

  /** Saves the order; `overrideReason` when Force Allow was confirmed. */
  function place(overrideReason?: string) {
    const form = new FormData(formRef.current!);
    const text = (name: string) => {
      const v = form.get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    const orderDate = text("orderDate");
    const shipmentDate = text("shipmentDate");
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
      totalCartons: cartons.trim() ? wholeNumber(cartons) : null,
      packedById: packedById || null,
      notes: text("notes") || null,
      customerName: text("customerName") || null,
      customerPhone: text("customerPhone") || null,
      shippingAddress: text("shippingAddress") || null,
      ...(overrideReason ? { forceOverride: { reason: overrideReason } } : {}),
    };
    const payment = takePayment
      ? {
          amount: charge(paymentAmount),
          method: paymentMethod,
          reference: text("paymentReference") || undefined,
          ...(isCheque
            ? {
                cheque: {
                  chequeNo: text("chequeNo"),
                  bankName: text("bankName") || null,
                  chequeDate: text("chequeDate") || undefined,
                },
              }
            : {}),
        }
      : undefined;
    const accountMoney = {
      ...(withPrevious ? { includePreviousDue: true } : {}),
      ...(creditUse > 0 ? { useCredit: creditUse } : {}),
    };

    startTransition(async () => {
      // The proof photo (already made small) goes up first; the order then points at it.
      let proofFileId: string | undefined;
      if (payment && proof) {
        const stored = await uploadProof(proof);
        if (!("id" in stored)) {
          setError({ ...stored, fieldErrors: { "payment.proofFileId": [stored.message] } });
          return;
        }
        proofFileId = stored.id;
      }
      const result = editing
        ? await updateOrderAction(editing.id, {
            matrix,
            ...charges,
            // With a live invoice the edit revises it (Smart Edit; the edit page says so).
            ...(editing.invoice ? { reviseInvoice: true } : {}),
          })
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
              ...accountMoney,
              ...(payment ? { payment: { ...payment, proofFileId } } : {}),
            });
      if (!result.ok) {
        const stock = Object.entries(result.error.fieldErrors ?? {})
          .filter(([key]) => key.startsWith("stock."))
          .map(([key, messages]) => [key.slice("stock.".length), messages[0] ?? ""] as const);
        setServerShort(Object.fromEntries(stock));
        setError(result.error);
        if (result.error.code === "INSUFFICIENT_STOCK") {
          setForceAllow(true);
          return;
        }
        const fields = Object.keys(result.error.fieldErrors ?? {}).filter(
          (key) => !key.startsWith("stock."),
        );
        // The pop-up stays only for a problem with the reason typed in it.
        if (!fields.includes("forceOverride.reason")) setForceAllow(false);
        if (fields.length > 0) setStep(Math.min(...fields.map(stepOf)));
        if (result.error.code !== "INTERNAL") toast.error(result.error.message);
        return;
      }
      setForceAllow(false);
      router.push(
        `${salesHref.order(result.data.id)}?${
          editing ? `saved=${editing.invoice ? "revised" : "1"}` : "created=1"
        }`,
      );
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in a field moves on a step; only the last step places the order.
    if (step < LAST) {
      next();
      return;
    }
    const form = new FormData(event.currentTarget);
    const found: Record<string, string> = {};
    for (let index = 0; index <= LAST; index++) Object.assign(found, problemsOn(index, form));
    setProblems(found);
    const fields = Object.keys(found);
    if (fields.length > 0) {
      setStep(Math.min(...fields.map(stepOf)));
      return;
    }
    if (shortCount > 0) {
      setForceAllow(true);
      return;
    }
    place();
  }

  const hasFieldErrors =
    Object.keys(problems).length > 0 ||
    Object.keys(error?.fieldErrors ?? {}).some((key) => !key.startsWith("stock."));
  const blocked = credit.state === "refused" || credit.state === "checking";

  return (
    <form ref={formRef} onSubmit={submit} className="grid min-w-0 scroll-mt-24 gap-8" noValidate>
      <Steps step={step} onGo={go} />

      <div hidden={step !== 0} className="grid min-w-0 gap-8">
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
      </div>

      <div hidden={step !== 1} className="grid min-w-0 gap-8">
        <Section
          title="Products"
          hint={
            <>
              Add each style, then type the pieces per colour and size, or use Magic Ratio. Prices
              are {wholesale ? "wholesale" : "retail"}; a price typed for a style applies to all of
              it.
            </>
          }
        >
          {proforma && proforma.items.length > 0 && (
            <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
              <p className="font-medium">The proforma asked for</p>
              <ul className="mt-2 grid gap-1 text-muted-foreground">
                {proforma.items.map((item) => (
                  <li key={item.id} className="break-words">
                    {item.custom ? "Custom: " : ""}
                    {item.description} · {formatCount(item.quantity, currency)} pcs ×{" "}
                    {money(item.unitPrice, currency)}
                    {item.sizes
                      ? ` (${item.sizes.map((s) => `${s.size} ${s.quantity}`).join(", ")})`
                      : ""}
                  </li>
                ))}
              </ul>
              {proforma.items.some((item) => item.custom) && (
                <p className="mt-2 text-[0.8125rem] text-muted-foreground">
                  Custom items are not in Products, so they cannot be sold from stock as they are.
                  Add the finished style in Products first, then add it here.
                </p>
              )}
            </div>
          )}
          {blocks.length > 0 && (
            <ol className="grid grid-cols-1 gap-3">
              {blocks.map((block) => (
                <StyleCard
                  key={block.key}
                  block={block}
                  open={openKey === block.key}
                  onToggle={() => setOpenKey((k) => (k === block.key ? null : block.key))}
                  wholesale={wholesale}
                  currency={currency}
                  own={own}
                  short={short}
                  fieldError={fieldError}
                  amount={blockAmount(block)}
                  presets={data.ratioPresets}
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
                setOpenKey(key);
                void loadBlock(key, style.id, warehouseId);
              }}
            />
          </Field>
        </Section>
      </div>

      <div hidden={step !== 2} className="grid min-w-0 gap-8">
        <Section title="Charges">
          <div className="grid items-start gap-5 sm:grid-cols-3">
            <Field
              id="order-discount"
              label={`Discount (${currency})`}
              hint="A lump sum off the whole bill: an agreed price or a round-off."
              error={fieldError("discount")}
              className="sm:col-span-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="order-discount"
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0.00"
                  autoComplete="off"
                  className="sm:w-48"
                  aria-invalid={Boolean(fieldError("discount"))}
                  aria-describedby={
                    fieldError("discount") ? "order-discount-error" : "order-discount-hint"
                  }
                />
                <div className="flex gap-2">
                  {(
                    [
                      [10, "Round to 10"],
                      [100, "Round to 100"],
                    ] as const
                  ).map(([unit, label]) => (
                    <Button
                      key={unit}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => roundOff(unit)}
                      disabled={beforeDiscount <= 0}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </Field>
            {(
              [
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
        </Section>
        <Section title="Delivery" hint="Both can be filled in later from the order too.">
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Field
              id="order-cartons"
              label="Total cartons (optional)"
              error={fieldError("totalCartons")}
            >
              <Input
                id="order-cartons"
                inputMode="numeric"
                value={cartons}
                onChange={(e) => setCartons(e.target.value)}
                placeholder="0"
                autoComplete="off"
                className="sm:w-32"
                aria-invalid={Boolean(fieldError("totalCartons"))}
              />
            </Field>
            <Field
              id="order-packer"
              label="Packed by (optional)"
              hint={data.packers.length === 0 ? "Add staff in HR to choose them here." : undefined}
              error={fieldError("packedById")}
            >
              <NativeSelect
                id="order-packer"
                value={packedById}
                onChange={(e) => setPackedById(e.target.value)}
                disabled={data.packers.length === 0}
                containerClassName="sm:w-full"
              >
                <option value="">Not yet</option>
                {data.packers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
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
      </div>

      <div hidden={step !== LAST} className="grid min-w-0 gap-8">
        <Section title="Review">
          <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2 sm:p-5">
            <div className="min-w-0">
              <dt className="eyebrow">Customer</dt>
              <dd className="mt-1 break-words">
                {buyer?.name ?? "Walk-in customer"} · {CHANNEL_LABELS[channel]}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="eyebrow">Products</dt>
              <dd className="mt-1">
                {blocks
                  .filter((b) => b.matrix && blockPieces(b) > 0)
                  .map(
                    (b) => `${b.matrix!.style.code} ${formatCount(blockPieces(b), currency)} pcs`,
                  )
                  .join(" · ") || "None yet"}
              </dd>
            </div>
            {(cartons.trim() || packedById) && (
              <div className="min-w-0">
                <dt className="eyebrow">Delivery</dt>
                <dd className="mt-1">
                  {[
                    cartons.trim() ? `${cartons.trim()} cartons` : null,
                    packedById
                      ? `packed by ${data.packers.find((p) => p.id === packedById)?.name ?? ""}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </div>
            )}
          </dl>
          {buyer && credit.state !== "idle" && (
            <div
              role="status"
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-4 text-sm",
                credit.state === "refused"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-primary/20 bg-secondary/40",
              )}
            >
              {credit.state === "checking" ? (
                <LoaderCircleIcon className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
              ) : credit.state === "ok" ? (
                <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <TriangleAlertIcon
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
              )}
              <div className="grid gap-1">
                <p className="font-medium">
                  {credit.state === "checking"
                    ? "Checking the buyer's credit limit"
                    : credit.state === "ok"
                      ? "Within the buyer's credit limit"
                      : "This order cannot go on the buyer's credit"}
                </p>
                {credit.state === "refused" && (
                  <p className="text-muted-foreground">
                    {credit.message} Take part of it as a payment now, lower the order, or ask
                    Accounts to raise the limit.
                  </p>
                )}
              </div>
            </div>
          )}
          {shortCount > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                {shortCount === 1 ? "One SKU is" : `${shortCount} SKUs are`} short of stock.{" "}
                {data.can.forceOverride
                  ? "Placing the order asks you to Force Allow it."
                  : "Lower the pieces marked, or ask someone who may sell beyond stock."}
              </p>
            </div>
          )}
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
                hint="It also prints as page 2 of the invoice PDF, as a size matrix with the cartons and who packed them."
              />
              <Tick
                id="doc-challan"
                checked={documents.deliveryChallan}
                onChange={(deliveryChallan) => setDocuments((d) => ({ ...d, deliveryChallan }))}
                label="Hand the goods over now (delivery challan)"
                hint="Takes every piece out of stock now, as at a counter sale."
              />
            </div>
            {(canIncludePrevious || canUseCredit) && (
              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
                {canIncludePrevious && (
                  <Tick
                    id="include-previous"
                    checked={includePrevious}
                    onChange={setIncludePrevious}
                    label={`Include previous due (${money(fixed2(owed!.previousDue + creditUse), currency)})`}
                    hint={
                      creditUse > 0
                        ? "Prints what the buyer owed before this bill, with the credit used here shown as paid, and the Total payable. Only this order counts as a sale."
                        : "Prints what the buyer already owed on this invoice, with the Total payable. Only this order counts as a sale."
                    }
                  />
                )}
                {canUseCredit && (
                  <Field
                    id="use-credit"
                    label={`Use credit balance (${currency})`}
                    hint={`Available ${money(fixed2(owed!.credit), currency)}. Put some or all of the buyer's advance balance against this bill.`}
                    error={fieldError("useCredit")}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        id="use-credit"
                        inputMode="decimal"
                        value={creditText}
                        onChange={(e) => setCreditText(e.target.value)}
                        placeholder="0.00"
                        autoComplete="off"
                        className="sm:w-48"
                        aria-invalid={Boolean(fieldError("useCredit"))}
                        aria-describedby={
                          fieldError("useCredit") ? "use-credit-error" : "use-credit-hint"
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start sm:self-auto"
                        onClick={() => setCreditText(fixed2(Math.min(owed!.credit, total)))}
                        disabled={total <= 0}
                      >
                        Use the most
                      </Button>
                    </div>
                  </Field>
                )}
              </div>
            )}
            {data.can.takePayment && (
              <div className="grid gap-4">
                <Tick
                  id="take-payment"
                  checked={takePayment}
                  onChange={(on) => {
                    setTakePayment(on);
                    if (on && !paymentAmount && afterCredit > 0) {
                      setPaymentAmount(fixed2(afterCredit));
                    }
                  }}
                  label="Payment received now"
                  hint="A money receipt is made with the order."
                />
                {takePayment && (
                  <>
                    <div className="grid items-start gap-5 sm:grid-cols-3">
                      <Field
                        id="payment-amount"
                        label={`Amount (${currency})`}
                        hint={
                          extra > 0
                            ? withPrevious
                              ? `${money(fixed2(afterCredit), currency)} pays this bill; the other ${money(fixed2(extra), currency)} pays the buyer's older dues, oldest first, and any left is kept as advance balance.`
                              : owed && owed.earlier > 0
                                ? `${money(fixed2(afterCredit), currency)} pays this bill; the other ${money(fixed2(extra), currency)} goes on the buyer's account: it pays their earlier balance first, and any left is kept as advance balance.`
                                : `${money(fixed2(afterCredit), currency)} pays this bill; the other ${money(fixed2(extra), currency)} is kept as the buyer's advance balance.`
                            : undefined
                        }
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
                          aria-describedby={
                            fieldError("payment.amount")
                              ? "payment-amount-error"
                              : extra > 0
                                ? "payment-amount-hint"
                                : undefined
                          }
                        />
                      </Field>
                      <Field id="payment-method" label="Paid by">
                        <NativeSelect
                          id="payment-method"
                          name="paymentMethod"
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
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
                    {isCheque && (
                      <div className="grid gap-3">
                        <ChequeFields
                          idPrefix="checkout"
                          today={data.today}
                          fieldError={(name) => fieldError(`payment.cheque.${name}`)}
                        />
                        <p className="text-[0.8125rem] text-muted-foreground">
                          The cheque is kept as pending and the order stays due. It goes into the
                          bank when Accounts marks it cleared in Payments, Cheques.
                        </p>
                      </div>
                    )}
                    <ProofDrop
                      value={proof}
                      onChange={setProof}
                      error={fieldError("payment.proofFileId")}
                    />
                  </>
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
          {charge(discount) > 0 && (
            <div className="flex justify-between gap-4 text-muted-foreground">
              <span>Discount</span>
              <span>− {money(fixed2(charge(discount)), currency)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t pt-2 font-medium">
            <span>Total</span>
            <span className="font-serif text-lg">{money(fixed2(total), currency)}</span>
          </div>
          {withPrevious && (
            <>
              <div className="flex justify-between gap-4 text-muted-foreground">
                <span>Previous due</span>
                <span>{money(fixed2(previousShown), currency)}</span>
              </div>
              <div className="flex justify-between gap-4 font-medium">
                <span>Total payable</span>
                <span>{money(fixed2(total + previousShown), currency)}</span>
              </div>
            </>
          )}
          {creditUse > 0 && (
            <div className="flex justify-between gap-4 text-muted-foreground">
              <span>Credit used</span>
              <span>− {money(fixed2(creditUse), currency)}</span>
            </div>
          )}
          {payNow > 0 && !isCheque && accountLines && (
            <div className="flex justify-between gap-4 text-muted-foreground">
              <span>Paid now</span>
              <span>− {money(fixed2(payNow), currency)}</span>
            </div>
          )}
          {accountLines && (
            <div className="flex justify-between gap-4 font-medium">
              <span>Balance due</span>
              <span>{money(fixed2(Math.max(balanceAfter, 0)), currency)}</span>
            </div>
          )}
          {extra > 0 && keptAfter > 0.004 && (
            <div className="flex justify-between gap-4 text-muted-foreground">
              <span>{withPrevious ? "Advance balance after this" : "Kept as advance balance"}</span>
              <span>{money(fixed2(keptAfter), currency)}</span>
            </div>
          )}
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
      </div>

      {hasFieldErrors && <FormAlert>Please check the highlighted fields.</FormAlert>}
      {error &&
        error.code !== "INTERNAL" &&
        error.code !== "INSUFFICIENT_STOCK" &&
        !error.fieldErrors && <FormAlert>{error.message}</FormAlert>}

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-col gap-3 border-t bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 md:bottom-4 md:mx-0 md:rounded-lg md:border md:px-5 md:shadow-[0_12px_32px_-16px_rgb(11_61_46/0.35)]">
        <p className="text-sm tabular-nums">
          <span className="text-muted-foreground">{formatCount(pieces, currency)} pcs · </span>
          <span className="font-medium">{money(fixed2(total), currency)}</span>
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:flex">
          {step === 0 ? (
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
          ) : (
            <Button type="button" variant="outline" onClick={() => go(step - 1)} disabled={pending}>
              Back
            </Button>
          )}
          {step < LAST ? (
            <Button type="button" onClick={next}>
              Next: {STEPS[step + 1]}
            </Button>
          ) : (
            <Button type="submit" disabled={pending || blocked}>
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending
                ? "Saving"
                : editing
                  ? editing.invoice
                    ? "Save and revise the invoice"
                    : "Save the changes"
                  : proforma
                    ? "Make the order"
                    : "Place the order"}
            </Button>
          )}
        </div>
      </div>

      {forceAllow && (
        <ForceAllowDialog
          short={short}
          canForce={data.can.forceOverride}
          pending={pending}
          error={fieldError("forceOverride.reason")}
          onBack={() => {
            setForceAllow(false);
            go(1);
          }}
          onAllow={(reason) => place(reason)}
        />
      )}
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
 * Asked when the order wants more pieces than are ready: lists the SKUs short
 * and, for people who may sell beyond stock, takes the reason and goes ahead.
 */
function ForceAllowDialog({
  short,
  canForce,
  pending,
  error,
  onBack,
  onAllow,
}: {
  short: Record<string, string>;
  canForce: boolean;
  pending: boolean;
  error?: string;
  onBack: () => void;
  onAllow: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string>();
  const entries = Object.entries(short);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onBack()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Not enough stock</DialogTitle>
          <DialogDescription>
            {entries.length === 1 ? "One SKU asks" : `${entries.length} SKUs ask`} for more pieces
            than are ready.
            {canForce
              ? " Force Allow sells them anyway: stock goes below zero until it is made, and the order is flagged."
              : " Lower the pieces, or ask someone who may sell beyond stock."}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-3 text-sm">
          {entries.map(([sku, message]) => (
            <li key={sku} className="break-words">
              <span className="font-medium">{sku}</span>
              <span className="text-muted-foreground">: {message || "no longer available"}</span>
            </li>
          ))}
        </ul>
        {canForce && (
          <Field
            id="force-reason"
            label="Why"
            hint="Kept on the order and in the activity log."
            error={problem ?? error}
          >
            <Textarea
              id="force-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={(problem ?? error) ? "force-reason-error" : "force-reason-hint"}
            />
          </Field>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            Change the pieces
          </Button>
          {canForce && (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (reason.trim().length < 5) {
                  setProblem("Write at least 5 letters.");
                  return;
                }
                setProblem(undefined);
                onAllow(reason.trim());
              }}
            >
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? "Saving" : "Force Allow"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Converting a proforma: the quotation's size breakdowns fill the pieces in. An
 * item lands on the style's colour when the style comes in one colour, or on the
 * colour its "Colours" note names (one colour, the same name); items of the same
 * style and colour add up. Otherwise (and when editing) the quantities stay as
 * they are.
 */
function prefill(block: Block, matrix: SaleMatrix, data: OrderFormData): Record<string, string> {
  if (!data.proforma || Object.keys(block.quantities).length > 0) return block.quantities;
  const filled: Record<string, number> = {};
  for (const item of data.proforma.items) {
    if (item.style?.id !== block.styleId || !item.sizes) continue;
    const named = item.colorNote?.trim().toLowerCase();
    const row =
      matrix.rows.length === 1
        ? matrix.rows[0]
        : matrix.rows.find((r) => named && r.color.name.toLowerCase() === named);
    if (!row) continue;
    matrix.sizes.forEach((size, index) => {
      const cell = row.cells[index];
      const wanted = item.sizes!.find((s) => s.size === size.name)?.quantity;
      if (cell && cell.isActive !== false && wanted) {
        filled[cell.variantId] = (filled[cell.variantId] ?? 0) + wanted;
      }
    });
  }
  return Object.keys(filled).length > 0
    ? Object.fromEntries(Object.entries(filled).map(([variantId, q]) => [variantId, String(q)]))
    : block.quantities;
}
