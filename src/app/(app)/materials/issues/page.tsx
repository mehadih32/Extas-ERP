import { SendIcon, Undo2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { IssueList } from "@/components/materials/issue-list";
import { materialsHref } from "@/components/materials/labels";
import {
  issueListQuery,
  issueViewFrom,
  isMaterialsFiltered,
  materialsListSearch,
} from "@/components/materials/list-view";
import { MaterialsFilters } from "@/components/materials/materials-filters";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getIssueListAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Issue notes" };

/**
 * Materials handed to production and taken back, newest first, like GET
 * /api/materials/issues (materials.view): issued or taken back, one project's.
 * Costs show to people who see material prices; the store team
 * (materials.manage) writes the notes.
 */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = issueViewFrom(await searchParams);
  const result = await getIssueListAction(issueListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return (
      <SectionError title="Issue notes" heading="The notes could not load" error={result.error} />
    );
  }
  const { items, nextCursor, project, seeCosts, canIssue } = result.data;

  return (
    <section aria-labelledby="issues-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="issues-heading" className="font-serif text-2xl text-primary">
            Issue notes
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Materials handed from the store to production, and what came back unused.
          </p>
        </div>
        {canIssue && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full sm:w-auto">
              <Link href={materialsHref.newIssue("issue", project?.id)}>
                <SendIcon aria-hidden />
                Issue to production
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={materialsHref.newIssue("return", project?.id)}>
                <Undo2Icon aria-hidden />
                Take back
              </Link>
            </Button>
          </div>
        )}
      </div>

      <MaterialsFilters
        view={view}
        named={
          project
            ? { text: `Notes for ${project.code} · ${project.name}`, clear: "All notes" }
            : null
        }
      >
        {items.length === 0 ? (
          isMaterialsFiltered(view) ? (
            <EmptyState title="No notes match">Clear the filters to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="Nothing issued yet"
              action={
                canIssue ? (
                  <Button asChild>
                    <Link href={materialsHref.newIssue("issue")}>Issue the first materials</Link>
                  </Button>
                ) : undefined
              }
            >
              Each time materials leave the store for a production project, an issue note records
              what went and its cost.
            </EmptyState>
          )
        ) : (
          <IssueList
            key={materialsListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
            seeCosts={seeCosts}
          />
        )}
      </MaterialsFilters>
    </section>
  );
}
