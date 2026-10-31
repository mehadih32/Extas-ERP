import type { Metadata } from "next";
import Link from "next/link";

import { Amount, PrivacyProvider, PrivacyToggle } from "@/components/accounts/privacy";
import { ReportPeriod } from "@/components/accounts/report-controls";
import { periodViewFrom } from "@/components/accounts/report-view";
import { SectionError } from "@/components/dashboard/section-error";
import { ReportsNoAccess } from "@/components/reports/no-access";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDayRange } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { PeriodPreset } from "@/modules/accounts/periods";
import {
  SOURCE_LABELS,
  SOURCES,
  type SourceFigures,
  type StockSource,
} from "@/modules/reports/source-compare.service";
import { getProductionVsReadyAction } from "@/server/actions/reports.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Production vs ready stock" };

const CHOICES: readonly PeriodPreset[] = ["ONE_WEEK", "ONE_MONTH", "SIX_MONTHS", "ONE_YEAR"];

const LINES: Array<{ key: keyof SourceFigures; label: string; kind: "int" | "money" | "pct" }> = [
  { key: "piecesIn", label: "Pieces in", kind: "int" },
  { key: "costIn", label: "Cost in", kind: "money" },
  { key: "piecesSold", label: "Pieces sold", kind: "int" },
  { key: "sales", label: "Sales", kind: "money" },
  { key: "cogs", label: "Cost of goods", kind: "money" },
  { key: "profit", label: "Profit", kind: "money" },
  { key: "profitPct", label: "Profit %", kind: "pct" },
];

function Value({
  f,
  line,
  currency,
}: {
  f: SourceFigures;
  line: (typeof LINES)[number];
  currency: string;
}) {
  const v = f[line.key];
  if (line.kind === "int") return <>{Number(v).toLocaleString("en-US")}</>;
  if (line.kind === "pct") return v === null ? <>-</> : <Amount>{`${v}%`}</Amount>;
  return <Amount>{money(String(v), currency)}</Amount>;
}

/**
 * Production vs ready stock: for a period, what came in from the factories and
 * what was bought as ready stock, side by side, with the sales, cost and profit
 * of each, and the same style by style (each style opens its page).
 */
export default async function ProductionVsReadyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const view = periodViewFrom(await searchParams);
  const result = await getProductionVsReadyAction(
    view.from || view.to ? { from: view.from, to: view.to } : { period: view.period },
  );
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ReportsNoAccess title="Costs and profit are not part of your role">
          This report shows what stock cost and the profit it made. The owner and Accounts see it.
        </ReportsNoAccess>
      );
    }
    return (
      <SectionError
        title="Production vs ready stock"
        heading="The report could not load"
        error={result.error}
      />
    );
  }
  const s = result.data;
  const { report, currency } = s;
  const shown: StockSource[] = SOURCES.filter(
    (k) => k !== "OTHER" || report.styles.some((r) => r.sources.OTHER),
  );
  const download = `/reports/new?metrics=PRODUCTION_VS_READY&from=${report.from}&to=${report.to}&title=${encodeURIComponent("Production vs ready stock")}`;

  return (
    <PrivacyProvider>
      <section aria-labelledby="source-heading" className="grid grid-cols-1 gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="source-heading" className="font-serif text-2xl text-primary">
              Production vs ready stock
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              What came in from production and what was bought as ready stock, and what each sold
              and earned. {formatDayRange(report.from, report.to)}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrivacyToggle />
            {s.canDownload && (
              <Link href={download} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Download PDF or Excel
              </Link>
            )}
          </div>
        </div>

        <ReportPeriod
          view={view}
          resolved={{ from: report.from, to: report.to }}
          today={s.today}
          choices={CHOICES}
          fallback="ONE_MONTH"
        >
          <div
            className={cn(
              "grid grid-cols-1 gap-4",
              shown.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2",
            )}
          >
            {shown.map((k) => (
              <Panel key={k} title={SOURCE_LABELS[k]} id={`source-${k}`}>
                <dl className="mt-4 grid grid-cols-1 gap-2 text-sm tabular-nums">
                  {LINES.map((line) => (
                    <div key={line.key} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{line.label}</dt>
                      <dd
                        className={cn(
                          "text-right",
                          line.key === "profit" && "font-medium",
                          line.key === "profit" &&
                            report.totals[k].profit.startsWith("-") &&
                            "text-destructive",
                        )}
                      >
                        <Value f={report.totals[k]} line={line} currency={currency} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            ))}
          </div>

          <Panel title="Style by style" id="styles-heading">
            {report.styles.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing came in or sold in this period.
              </p>
            ) : (
              <>
                <ol className="mt-4 grid grid-cols-1 divide-y md:hidden" aria-label="Styles">
                  {report.styles.map((r) => (
                    <li key={r.styleId} className="grid gap-2 py-3 text-sm first:pt-0 last:pb-0">
                      <Link
                        href={`/products/${r.styleId}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {r.styleCode} · {r.styleName}
                      </Link>
                      {r.shareNote && (
                        <p className="text-xs text-muted-foreground">Shared: {r.shareNote}</p>
                      )}
                      {SOURCES.filter((k) => r.sources[k]).map((k) => {
                        const f = r.sources[k]!;
                        return (
                          <p
                            key={k}
                            className="text-[0.8125rem] text-muted-foreground tabular-nums"
                          >
                            <span className="font-medium text-foreground">{SOURCE_LABELS[k]}</span>:{" "}
                            {f.piecesIn} in · {f.piecesSold} sold · sales{" "}
                            <Amount>{money(f.sales, currency)}</Amount> · profit{" "}
                            <Amount>{money(f.profit, currency)}</Amount>
                          </p>
                        );
                      })}
                    </li>
                  ))}
                </ol>
                <div className="mt-4 hidden md:block">
                  <Table aria-label="Styles">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Style</TableHead>
                        <TableHead>Came in as</TableHead>
                        {LINES.map((l) => (
                          <TableHead key={l.key} className="text-right">
                            {l.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.styles.flatMap((r) =>
                        SOURCES.filter((k) => r.sources[k]).map((k, i) => (
                          <TableRow key={`${r.styleId}-${k}`} className={cn(i > 0 && "border-t-0")}>
                            <TableCell className="align-top">
                              {i === 0 && (
                                <div className="grid gap-0.5">
                                  <Link
                                    href={`/products/${r.styleId}`}
                                    className="font-medium text-primary underline-offset-4 hover:underline"
                                  >
                                    {r.styleCode}
                                  </Link>
                                  <span className="text-xs text-muted-foreground">
                                    {r.styleName}
                                  </span>
                                  {r.shareNote && (
                                    <span className="text-xs text-muted-foreground">
                                      Shared: {r.shareNote}
                                    </span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="align-top">{SOURCE_LABELS[k]}</TableCell>
                            {LINES.map((l) => (
                              <TableCell key={l.key} className="text-right align-top tabular-nums">
                                <Value f={r.sources[k]!} line={l} currency={currency} />
                              </TableCell>
                            ))}
                          </TableRow>
                        )),
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              A sale does not say which batch its pieces came from, so a style that came both ways
              shares its sales by the pieces that came in each way.
            </p>
          </Panel>
        </ReportPeriod>
      </section>
    </PrivacyProvider>
  );
}
