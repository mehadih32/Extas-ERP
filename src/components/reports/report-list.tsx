"use client";

import { DownloadIcon } from "lucide-react";

import { RowCard, RowLink, ShowMore, useLoadMore } from "@/components/sales/load-more";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReportRow } from "@/modules/reports/screens.service";
import { listReportRowsAction } from "@/server/actions/reports.actions";

import { ReportBadges } from "./badges";
import { reportsHref } from "./labels";

/** The saved reports: cards on phones, a table on computers, with "Show more". */
export function ReportList({
  initial,
  mine,
}: {
  initial: { items: ReportRow[]; nextCursor?: string };
  mine: boolean;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listReportRowsAction({ mine: mine ? "1" : undefined, cursor }),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden" aria-label="Reports">
        {list.items.map((r) => (
          <RowCard
            key={r.id}
            href={reportsHref.report(r.id)}
            eyebrow={r.range}
            badges={<ReportBadges format={r.format} status={r.status} />}
            title={r.title}
            details={r.metricLabels.join(", ")}
            footer={
              <>
                <span className="text-muted-foreground">{r.requestedBy?.name ?? "Someone"}</span>
                <span className="text-muted-foreground">{r.madeOn}</span>
              </>
            }
          />
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Reports">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Report</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Made by</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Download</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="py-3">
                  <RowLink href={reportsHref.report(r.id)} className="whitespace-normal">
                    {r.title}
                  </RowLink>
                  <div className="mt-1 max-w-96 text-[0.8125rem] text-muted-foreground">
                    {r.metricLabels.join(", ")}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.range}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <ReportBadges format={r.format} status={r.status} />
                  </div>
                </TableCell>
                <TableCell>
                  <div>{r.requestedBy?.name ?? "Someone"}</div>
                  <div className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                    {r.madeOn}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {r.downloadable && (
                    <a
                      href={reportsHref.download(r.id)}
                      download
                      className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                      aria-label={`Download ${r.title}, ${r.range}`}
                    >
                      <DownloadIcon className="size-4" aria-hidden />
                      Download
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="reports" />
    </div>
  );
}
