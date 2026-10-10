import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { reportsHref } from "@/components/reports/labels";
import { ReportsNoAccess } from "@/components/reports/no-access";
import { ReportList } from "@/components/reports/report-list";
import { DOCUMENT_KEYS, holdsAny } from "@/components/shell/nav-items";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getReportsScreenAction } from "@/server/actions/reports.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Reports" };

const tabLink = (current: boolean) =>
  cn(
    "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25",
    current ? "font-medium text-foreground" : "text-primary",
  );

/**
 * Saved reports (reports.export), newest first, each with its PDF or Excel file
 * to download again, and the way into the Report Builder. People who print
 * documents but make no reports land on their printed documents instead.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.permissions.has("reports.export")) {
    if (holdsAny(ctx.permissions, DOCUMENT_KEYS)) redirect(reportsHref.documents());
    if (ctx.permissions.has("templates.manage")) redirect(reportsHref.templates);
  }
  const mine = (await searchParams).mine === "1";
  const result = await getReportsScreenAction({ mine: mine ? "1" : undefined });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ReportsNoAccess />;
    return (
      <SectionError title="Reports" heading="The reports could not load" error={result.error} />
    );
  }
  const { list, canMake } = result.data;

  return (
    <section aria-labelledby="reports-heading" className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="reports-heading" className="font-serif text-2xl text-primary">
            Reports
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Sales, profit, top sellers and stock for any period, as a PDF or an Excel file. Each
            report is kept here to download again.
          </p>
        </div>
        {canMake && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={reportsHref.builder()}>
              <PlusIcon aria-hidden />
              Make a report
            </Link>
          </Button>
        )}
      </div>
      <nav aria-label="Whose reports" className="flex gap-x-4 text-sm">
        {mine ? (
          <Link href={reportsHref.reports} className={tabLink(false)}>
            Everyone&apos;s
          </Link>
        ) : (
          <span aria-current="page" className={tabLink(true)}>
            Everyone&apos;s
          </span>
        )}
        {mine ? (
          <span aria-current="page" className={tabLink(true)}>
            Only mine
          </span>
        ) : (
          <Link href={reportsHref.mine} className={tabLink(false)}>
            Only mine
          </Link>
        )}
      </nav>
      {list.items.length === 0 ? (
        <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          {mine ? "You have not made a report yet." : "No reports have been made yet."}
          {canMake && " Make one to see it here."}
        </p>
      ) : (
        <ReportList key={mine ? "mine" : "all"} initial={list} mine={mine} />
      )}
    </section>
  );
}
