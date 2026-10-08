"use client";

import { LoaderCircleIcon, PackageXIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { localDay } from "@/lib/dates";
import { formatCount, formatDay, formatDayRange, groupAmount } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { listBadStock } from "@/modules/inventory/stock.service";
import { listBadStockAction } from "@/server/actions/inventory.actions";

import {
  BAD_STOCK_PAGE_SIZE,
  BAD_STOCK_PERIODS,
  type BadStockPeriod,
  badStockSearch,
} from "./bad-stock-view";
import { EmptyState, Figure, Swatch } from "./bits";
import { BAD_STOCK_SOURCE_LABELS, GRADE_LABELS, money, pieces } from "./labels";
import { RecordBadStockDialog } from "./record-bad-stock-dialog";

export type BadStockPage = Awaited<ReturnType<typeof listBadStock>>;
type Entry = BadStockPage["items"][number];

function BadStockList({
  initial,
  range,
  currency,
  timeZone,
}: {
  initial: BadStockPage;
  range: { from?: string; to?: string };
  currency: string;
  timeZone: string;
}) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const showsCosts = initial.showsCosts;

  const day = (e: Entry) => formatDay(localDay(new Date(e.createdAt), timeZone));
  const from = (e: Entry) =>
    [e.warehouse?.name, e.grade ? GRADE_LABELS[e.grade] : null].filter(Boolean).join(" · ") || "—";
  const loss = (e: Entry) => (e.lossValue === null ? "—" : money(e.lossValue, currency));

  function more() {
    startTransition(async () => {
      const result = await listBadStockAction({ ...range, cursor, take: BAD_STOCK_PAGE_SIZE });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItems((shown) => [...shown, ...result.data.items]);
      setCursor(result.data.nextCursor);
    });
  }

  return (
    <div className="grid gap-5">
      <div className="hidden rounded-lg border bg-card px-5 py-1 md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Day</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Pieces</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>From</TableHead>
              <TableHead>By</TableHead>
              {showsCosts && <TableHead className="text-right">Loss ({currency})</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-muted-foreground">{day(e)}</TableCell>
                <TableCell className="max-w-[18rem] min-w-[12rem] whitespace-normal">
                  <div className="flex items-center gap-2 font-medium">
                    <Swatch hex={e.color.hexCode} />
                    <span className="truncate">
                      {e.style.name} · {e.color.name} / {e.size.name}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{e.sku}</div>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCount(e.quantity, currency)}
                </TableCell>
                <TableCell className="max-w-[16rem] whitespace-normal">
                  <div>{BAD_STOCK_SOURCE_LABELS[e.source]}</div>
                  {e.reason && <div className="text-xs text-muted-foreground">{e.reason}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{from(e)}</TableCell>
                <TableCell className="text-muted-foreground">{e.recordedBy?.name ?? "—"}</TableCell>
                {showsCosts && (
                  <TableCell className="text-right">
                    {e.lossValue === null ? "—" : groupAmount(e.lossValue, currency)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden" aria-label="Bad stock">
        {items.map((e) => (
          <li key={e.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <Swatch hex={e.color.hexCode} />
                  <span className="truncate">
                    {e.color.name} / {e.size.name}
                  </span>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {e.style.name} · {e.sku}
                </p>
              </div>
              <p className="font-serif text-lg whitespace-nowrap tabular-nums">
                {pieces(e.quantity, currency)}
              </p>
            </div>
            <p className="mt-2 text-sm">
              {BAD_STOCK_SOURCE_LABELS[e.source]}
              {e.reason ? `: ${e.reason}` : ""}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {day(e)} · {from(e)}
              {e.recordedBy ? ` · ${e.recordedBy.name}` : ""}
              {showsCosts && e.lossValue !== null ? ` · Loss ${loss(e)}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {cursor && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-center sm:w-auto"
          disabled={pending}
          onClick={more}
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {pending ? "Loading" : "Show older entries"}
        </Button>
      )}
      <ActionErrorDialog
        error={error}
        title="We could not load more entries"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}

/**
 * The Bad stock tab: pieces taken out of the sellable stock, when, why and by
 * whom, for a period. Everyone with inventory.view sees the pieces; what they
 * cost (the loss) shows only to people who see the financials, and recording
 * bad stock needs inventory.manage.
 */
export function BadStockScreen({
  page,
  period,
  range,
  canManage,
  currency,
  timeZone,
}: {
  page: BadStockPage;
  period: BadStockPeriod;
  range: { from?: string; to?: string };
  canManage: boolean;
  currency: string;
  timeZone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The period chosen, until its entries arrive.
  const [shownPeriod, setShownPeriod] = useOptimistic(period);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string>();
  const { totals } = page;

  function show(next: BadStockPeriod) {
    setNotice(undefined);
    startTransition(() => {
      setShownPeriod(next);
      router.replace(`${pathname}${badStockSearch(next)}`, { scroll: false });
    });
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <label className="sr-only" htmlFor="bad-period">
            Period
          </label>
          <NativeSelect
            id="bad-period"
            value={shownPeriod}
            onChange={(e) => show(e.target.value as BadStockPeriod)}
          >
            {BAD_STOCK_PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {range.from && range.to && (
            <p className="text-[0.8125rem] text-muted-foreground">
              {formatDayRange(range.from, range.to)}
            </p>
          )}
        </div>
        {canManage && (
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => {
              setNotice(undefined);
              setRecording(true);
            }}
          >
            <PackageXIcon aria-hidden />
            Record bad stock
          </Button>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      <div
        aria-busy={pending}
        className={cn("grid gap-6 transition-opacity", pending && "pointer-events-none opacity-50")}
      >
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Figure label="Entries" value={formatCount(totals.entries, currency)} />
          <Figure label="Pieces" value={formatCount(totals.pieces, currency)} />
          {page.showsCosts && totals.lossValue !== null && (
            <Figure label={`Loss (${currency})`} value={groupAmount(totals.lossValue, currency)} />
          )}
        </dl>
        {page.items.length === 0 ? (
          <EmptyState title={period === "ALL" ? "No bad stock yet" : "No bad stock in this period"}>
            {period === "ALL"
              ? "Damaged pieces and production rejects show here once they are moved out of the sellable stock."
              : "Pick a longer period to see older entries."}
          </EmptyState>
        ) : (
          <BadStockList
            key={`${period}:${page.items[0]?.id}`}
            initial={page}
            range={range}
            currency={currency}
            timeZone={timeZone}
          />
        )}
      </div>

      {recording && (
        <RecordBadStockDialog
          currency={currency}
          onClose={() => setRecording(false)}
          onDone={(moved) => {
            setRecording(false);
            setNotice(
              `${pieces(moved.quantity, currency)} of ${moved.sku} moved to bad stock${
                moved.lossValue ? `, a loss of ${money(moved.lossValue, currency)}` : ""
              }.`,
            );
          }}
        />
      )}
    </div>
  );
}
