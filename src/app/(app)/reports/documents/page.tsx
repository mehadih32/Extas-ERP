import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { PrintDocumentButton } from "@/components/documents/print-button";
import { DocumentTypeFilter } from "@/components/reports/document-filter";
import { DocumentList } from "@/components/reports/document-list";
import { reportsHref } from "@/components/reports/labels";
import { DocumentsNoAccess } from "@/components/reports/no-access";
import { WriteLetterButton } from "@/components/reports/write-letter";
import { Panel } from "@/components/sales/detail-bits";
import { getDocumentsScreenAction } from "@/server/actions/documents.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Printed documents" };

/**
 * Every PDF printed from the app that this person may see (sales documents,
 * statements, stock sheets, payslips for salary viewers), newest first, with
 * the file to open again and a link to what it was printed for; and, for
 * people who write letters, the letterhead and the company's letter templates.
 */
export default async function PrintedDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const { type: raw } = await searchParams;
  const asked = typeof raw === "string" && raw ? raw : undefined;
  const result = await getDocumentsScreenAction({ type: asked });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <DocumentsNoAccess />;
    if (result.error.code === "VALIDATION")
      return (
        <SectionError
          title="Printed documents"
          heading="There is no such kind of document"
          error={result.error}
        />
      );
    return (
      <SectionError
        title="Printed documents"
        heading="The printed documents could not load"
        error={result.error}
      />
    );
  }
  const { type, types, list, letterTemplates, can } = result.data;

  return (
    <div className="grid grid-cols-1 gap-8">
      {can.letterhead && (
        <Panel title="Letters" id="letters-heading">
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {letterTemplates.length > 0
              ? "Print the blank company letterhead, or write a letter on one of the company's letter templates."
              : "Print the blank company letterhead to write on."}
            {can.templates && letterTemplates.length === 0 && (
              <>
                {" "}
                To write letters on your own design,{" "}
                <Link
                  href={reportsHref.templates}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  add a letter template
                </Link>
                .
              </>
            )}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <WriteLetterButton templates={letterTemplates} pickParty={can.pickParty} />
            <PrintDocumentButton
              request={{ type: "LETTERHEAD" }}
              label="Blank letterhead"
              ready={{
                eyebrow: "Letterhead",
                description: "The company letterhead with nothing written on it, ready to print.",
                errorTitle: "We could not make the letterhead",
              }}
            />
          </div>
        </Panel>
      )}

      <section aria-labelledby="documents-heading" className="grid grid-cols-1 gap-6">
        <div>
          <h2 id="documents-heading" className="font-serif text-2xl text-primary">
            Printed documents
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every PDF made from the app that your role may see, newest first. Printing the same
            thing again with nothing changed gives back the copy kept here.
          </p>
        </div>
        <DocumentTypeFilter type={type} types={types}>
          {list.items.length === 0 ? (
            <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
              {type
                ? "Nothing of this kind has been printed yet."
                : "Nothing has been printed yet."}{" "}
              Documents show here once someone makes their PDF.
            </p>
          ) : (
            <DocumentList key={type ?? "all"} initial={list} type={type} />
          )}
        </DocumentTypeFilter>
      </section>
    </div>
  );
}
