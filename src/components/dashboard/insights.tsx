import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDay, formatDayRange, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { getDashboardInsights } from "@/modules/dashboard/insights.service";

import { InsightsTabs } from "./insights-tabs";
import { TopSellersFilters } from "./top-sellers-filters";
import type { TopSellersView } from "./top-sellers-view";

export type InsightsData = Awaited<ReturnType<typeof getDashboardInsights>>;

/**
 * Which money columns this person sees, decided on the server with the same
 * rules the dashboard API uses (modules/dashboard/access.ts). The API already
 * sends hidden amounts as null; these only decide whether a column is drawn.
 */
export type InsightsColumns = { salesAmounts: boolean; financials: boolean };

type Product = {
  sku: string | null;
  styleCode: string;
  styleName: string;
  colorName: string | null;
  sizeName: string | null;
};

const DASH = "—";

function ProductCell({ product, skus }: { product: Product; skus?: number }) {
  const variant = [product.colorName, product.sizeName].filter(Boolean).join(" / ");
  const detail = product.sku
    ? [product.sku, variant].filter(Boolean).join(" · ")
    : `${product.styleCode} · ${skus ?? 0} ${skus === 1 ? "SKU" : "SKUs"}`;
  return (
    <TableCell className="max-w-[16rem] min-w-[11rem] whitespace-normal">
      <div className="truncate font-medium">{product.styleName}</div>
      <div className="truncate text-xs text-muted-foreground">{detail}</div>
    </TableCell>
  );
}

function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <TableCell className={cn("text-right", className)}>{children}</TableCell>;
}

function NumHead({ children }: { children: React.ReactNode }) {
  return <TableHead className="text-right">{children}</TableHead>;
}

function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed px-6 py-10 text-center">
      <p className="font-serif text-lg text-primary">{title}</p>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

function Summary({ items }: { items: Array<[label: string, value: string]> }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="eyebrow">{label}</dt>
          <dd className="mt-1 font-serif text-xl lining-nums tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TopSellersPanel({
  data,
  view,
  columns,
}: {
  data: InsightsData;
  view: TopSellersView;
  columns: InsightsColumns;
}) {
  const top = data.topSellers;
  const currency = data.currency;
  const count = (n: number) => formatCount(n, currency);
  const money = (v: string | null) => (v === null ? DASH : groupAmount(v, currency));
  const bySku = top.groupBy === "SKU";

  const summary: Array<[string, string]> = [
    ["Pieces sold", count(top.totals.pieces)],
    [bySku ? "SKUs sold" : "Styles sold", count(top.totals.sold)],
  ];
  if (columns.salesAmounts && top.totals.net !== null) {
    summary.push([`Net sales (${currency})`, money(top.totals.net)]);
  }
  if (columns.financials && top.totals.marginPct !== null) {
    summary.push(["Margin", `${top.totals.marginPct}%`]);
  }

  return (
    <TopSellersFilters view={view} canSortBySales={columns.salesAmounts}>
      <p className="mb-4 text-[0.8125rem] text-muted-foreground">
        {formatDayRange(top.period.from, top.period.to)}
      </p>
      {top.items.length === 0 ? (
        <Empty title="No sales in this period">Pick a longer period to see what sells best.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <Summary items={summary} />
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8">#</TableHead>
                <TableHead>{bySku ? "SKU" : "Style"}</TableHead>
                <NumHead>Pieces</NumHead>
                <NumHead>Share</NumHead>
                {columns.salesAmounts && <NumHead>Net sales</NumHead>}
                {columns.salesAmounts && <NumHead>Avg price</NumHead>}
                {columns.financials && <NumHead>Margin</NumHead>}
                <NumHead>In stock</NumHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground">{item.rank}</TableCell>
                  <ProductCell product={item} skus={item.skus} />
                  <Num className="font-medium">{count(item.pieces)}</Num>
                  <Num>{item.sharePct === null ? DASH : `${item.sharePct}%`}</Num>
                  {columns.salesAmounts && <Num>{money(item.net)}</Num>}
                  {columns.salesAmounts && <Num>{money(item.avgPrice)}</Num>}
                  {columns.financials && (
                    <Num>{item.marginPct === null ? DASH : `${item.marginPct}%`}</Num>
                  )}
                  <Num className={cn(item.available <= 0 && "text-destructive")}>
                    {count(item.available)}
                  </Num>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </TopSellersFilters>
  );
}

function HighestStockPanel({ data, columns }: { data: InsightsData; columns: InsightsColumns }) {
  const currency = data.currency;
  const count = (n: number) => formatCount(n, currency);
  if (data.highestStock.length === 0) {
    return <Empty title="No stock on hand yet">Stock appears here once goods are received.</Empty>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>SKU</TableHead>
          <NumHead>Available</NumHead>
          <NumHead>A grade</NumHead>
          <NumHead>B grade</NumHead>
          <NumHead>Reserved</NumHead>
          {columns.financials && <NumHead>Value ({currency})</NumHead>}
          <NumHead>Sold, 30 days</NumHead>
          <TableHead>Last sold</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.highestStock.map((row) => (
          <TableRow key={row.variantId}>
            <ProductCell product={row} />
            <Num className="font-medium">{count(row.available)}</Num>
            <Num>{count(row.aGrade)}</Num>
            <Num>{count(row.bGrade)}</Num>
            <Num>{count(row.reserved)}</Num>
            {columns.financials && (
              <Num>{row.value === null ? DASH : groupAmount(row.value, currency)}</Num>
            )}
            <Num>{count(row.soldRecently)}</Num>
            <TableCell className="text-muted-foreground">
              {row.lastSoldOn ? formatDay(row.lastSoldOn) : "Never"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DeadAndSlowPanel({ data, columns }: { data: InsightsData; columns: InsightsColumns }) {
  const { dead, slow, slowDays, coverDays, items } = data.deadAndSlow;
  const currency = data.currency;
  const count = (n: number) => formatCount(n, currency);
  const group = (g: { skus: number; pieces: number; value: string | null }) =>
    [
      `${count(g.skus)} ${g.skus === 1 ? "SKU" : "SKUs"}`,
      `${count(g.pieces)} pcs`,
      columns.financials && g.value !== null
        ? `${currency} ${groupAmount(g.value, currency)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-destructive/20 bg-destructive/[0.03] p-4">
          <p className="eyebrow text-destructive">Dead stock</p>
          <p className="mt-1.5 font-serif text-lg lining-nums tabular-nums">{group(dead)}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            In stock {slowDays} days ago and not one piece sold since
          </p>
        </div>
        <div className="rounded-md border p-4">
          <p className="eyebrow">Slow stock</p>
          <p className="mt-1.5 font-serif text-lg lining-nums tabular-nums">{group(slow)}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            At the last {slowDays} days&apos; pace, would last over {coverDays} days
          </p>
        </div>
      </div>
      {items.length === 0 ? (
        <Empty title="Everything is moving">No dead or slow stock right now.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>SKU</TableHead>
              <TableHead>Status</TableHead>
              <NumHead>Available</NumHead>
              <NumHead>Sold, {slowDays} days</NumHead>
              <NumHead>Days of cover</NumHead>
              {columns.financials && <NumHead>Value ({currency})</NumHead>}
              <TableHead>Last sold</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.variantId}>
                <ProductCell product={row} />
                <TableCell>
                  <Badge variant={row.movement === "DEAD" ? "alert" : "outline"}>
                    {row.movement === "DEAD" ? "Dead" : "Slow"}
                  </Badge>
                </TableCell>
                <Num className="font-medium">{count(row.available)}</Num>
                <Num>{count(row.soldInWindow)}</Num>
                <Num>{row.daysOfCover === null ? DASH : count(row.daysOfCover)}</Num>
                {columns.financials && (
                  <Num>{row.value === null ? DASH : groupAmount(row.value, currency)}</Num>
                )}
                <TableCell className="text-muted-foreground">
                  {row.lastSoldOn ? formatDay(row.lastSoldOn) : "Never"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function LowStockPanel({ data }: { data: InsightsData }) {
  const { threshold, total, outOfStock, items, soldRecentlyDays } = data.lowStock;
  const currency = data.currency;
  const count = (n: number) => formatCount(n, currency);
  if (items.length === 0) {
    return (
      <Empty title="Nothing is running low">
        Every SKU has at least {threshold} pieces available.
      </Empty>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5">
      <Summary
        items={[
          [`Below ${threshold} pieces`, count(total)],
          ["Out of stock", count(outOfStock)],
        ]}
      />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>SKU</TableHead>
            <NumHead>Available</NumHead>
            <NumHead>On hand</NumHead>
            <NumHead>Reserved</NumHead>
            <NumHead>Sold, {soldRecentlyDays} days</NumHead>
            <TableHead>Last sold</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.variantId}>
              <ProductCell product={row} />
              <Num className={cn("font-medium", row.available <= 0 && "text-destructive")}>
                {count(row.available)}
              </Num>
              <Num>{count(row.onHand)}</Num>
              <Num>{count(row.reserved)}</Num>
              <Num>{count(row.soldRecently)}</Num>
              <TableCell className="text-muted-foreground">
                {row.lastSoldOn ? formatDay(row.lastSoldOn) : "Never"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {total > items.length && (
        <p className="text-[0.8125rem] text-muted-foreground">
          Showing the {items.length} most urgent of {count(total)}.
        </p>
      )}
    </div>
  );
}

/**
 * The blueprint's Insights widget: top selling SKUs, highest stock, dead and
 * slow stock, and the low stock warning (below the company's threshold).
 */
export function Insights({
  data,
  view,
  columns,
}: {
  data: InsightsData;
  view: TopSellersView;
  columns: InsightsColumns;
}) {
  const low = data.lowStock;
  const deadAndSlow = data.deadAndSlow.dead.skus + data.deadAndSlow.slow.skus;
  const notice =
    low.total > 0
      ? {
          message:
            `${formatCount(low.total, data.currency)} ${low.total === 1 ? "SKU is" : "SKUs are"} below ${low.threshold} pieces` +
            (low.outOfStock > 0
              ? `, ${formatCount(low.outOfStock, data.currency)} out of stock.`
              : "."),
          action: "See the list",
          tab: "low",
        }
      : undefined;

  return (
    <section aria-labelledby="insights">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="insights" className="font-serif text-2xl text-primary">
          Insights
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">Stock as of {formatDay(data.asOf)}</p>
      </div>
      <InsightsTabs
        notice={notice}
        tabs={[
          {
            value: "top",
            label: "Top sellers",
            content: <TopSellersPanel data={data} view={view} columns={columns} />,
          },
          {
            value: "highest",
            label: "Highest stock",
            content: <HighestStockPanel data={data} columns={columns} />,
          },
          {
            value: "slow",
            label: "Dead & slow",
            count: deadAndSlow,
            content: <DeadAndSlowPanel data={data} columns={columns} />,
          },
          {
            value: "low",
            label: "Low stock",
            count: low.total,
            alert: true,
            content: <LowStockPanel data={data} />,
          },
        ]}
      />
    </section>
  );
}
