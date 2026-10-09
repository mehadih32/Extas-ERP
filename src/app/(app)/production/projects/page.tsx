import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import {
  isProductionFiltered,
  productionListSearch,
  projectListQuery,
  projectViewFrom,
} from "@/components/production/list-view";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProductionFilters } from "@/components/production/production-filters";
import { ProjectList } from "@/components/production/project-list";
import { Button } from "@/components/ui/button";
import { getProjectListAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Production projects" };

/**
 * Every production project, newest first, for production.view like GET
 * /api/production/projects. Starting one is offered to production.manage, the
 * permission createProjectAction checks.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = projectViewFrom(await searchParams);
  const result = await getProjectListAction(projectListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Projects" heading="The projects could not load" error={result.error} />
    );
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="projects-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="projects-heading" className="font-serif text-2xl text-primary">
            Projects
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Batches made in a factory, for a buyer or for our own stock, from fabric to finished
            pieces.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/production/projects/new">
              <PlusIcon aria-hidden />
              New project
            </Link>
          </Button>
        )}
      </div>

      <ProductionFilters view={view}>
        {items.length === 0 ? (
          isProductionFiltered(view) ? (
            <EmptyState title="No projects match">
              Try a project code, part of its name, the factory or the buyer, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              title="No projects yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href="/production/projects/new">Start the first project</Link>
                  </Button>
                ) : undefined
              }
            >
              A project follows a batch through cutting, sewing and finishing until its pieces are
              in stock.
            </EmptyState>
          )
        ) : (
          <ProjectList
            key={productionListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </ProductionFilters>
    </section>
  );
}
