"use client";

import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/sales/badges";
import { ShowMore, useLoadMore } from "@/components/sales/load-more";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DocumentRow } from "@/modules/reports/screens.service";
import { listDocumentRowsAction } from "@/server/actions/documents.actions";

import { fileSize, reportsHref, TEMPLATE_FORMAT_LABELS } from "./labels";

const actionLink =
  "inline-flex items-center gap-1.5 rounded-sm text-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25";

/** Open (PDFs) and Download, or why the file is gone. */
function FileLinks({ d }: { d: DocumentRow }) {
  if (!d.downloadable) {
    return <span className="text-sm text-muted-foreground">File no longer kept</span>;
  }
  const file = reportsHref.documentFile(d.id);
  return (
    <>
      {d.isPdf && (
        <a
          href={`${file}?inline=1`}
          target="_blank"
          rel="noopener"
          className={actionLink}
          aria-label={`Open ${d.title}`}
        >
          <ExternalLinkIcon className="size-4" aria-hidden />
          Open
        </a>
      )}
      <a href={file} download className={actionLink} aria-label={`Download ${d.title}`}>
        <DownloadIcon className="size-4" aria-hidden />
        Download
      </a>
    </>
  );
}

function TemplateBadge({ d }: { d: DocumentRow }) {
  if (!d.template) return null;
  return (
    <StatusBadge tone="plain">
      {TEMPLATE_FORMAT_LABELS[d.template.format as keyof typeof TEMPLATE_FORMAT_LABELS]}
    </StatusBadge>
  );
}

/** Who it is for and which design it was filled from. */
function details(d: DocumentRow) {
  return [d.party?.name, d.template && `On "${d.template.name}"`].filter(Boolean).join(" · ");
}

/**
 * Printed documents, newest first: cards on phones, a table on computers, each
 * with its file to open or download and a link to what it was printed for.
 */
export function DocumentList({
  initial,
  type,
}: {
  initial: { items: DocumentRow[]; nextCursor?: string };
  type: string | null;
}) {
  const list = useLoadMore(initial, (cursor) =>
    listDocumentRowsAction({ type: type ?? undefined, cursor }),
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <ul
        className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden"
        aria-label="Printed documents"
      >
        {list.items.map((d) => (
          <li key={d.id} className="grid min-w-0 grid-cols-1 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow min-w-0 truncate">{d.typeLabel}</p>
              <div className="-my-1 flex shrink-0 gap-1.5">
                <TemplateBadge d={d} />
              </div>
            </div>
            <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">
              {d.title}
            </p>
            {details(d) && (
              <p className="mt-1 text-sm break-words text-muted-foreground">{details(d)}</p>
            )}
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">
              {d.generatedBy?.name ?? "Someone"} · {d.madeOn}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3">
              <FileLinks d={d} />
              {d.source && (
                <Link href={d.source.href} className={actionLink}>
                  {d.source.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden lg:block">
        <Table aria-label="Printed documents">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Document</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Made by</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">File</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="py-3 whitespace-normal">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.title}</span>
                    <TemplateBadge d={d} />
                  </div>
                  <div className="mt-1 text-[0.8125rem] text-muted-foreground">
                    {d.typeLabel}
                    {d.template && ` · on "${d.template.name}"`}
                    {d.sizeBytes !== null && ` · ${fileSize(d.sizeBytes)}`}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {d.party?.name ?? <span className="text-muted-foreground">—</span>}
                  {d.source && (
                    <div className="mt-1">
                      <Link href={d.source.href} className={actionLink}>
                        {d.source.label}
                      </Link>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div>{d.generatedBy?.name ?? "Someone"}</div>
                  <div className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">
                    {d.madeOn}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-4">
                    <FileLinks d={d} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShowMore list={list} noun="documents" />
    </div>
  );
}
