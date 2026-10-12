import { PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { BatchList } from "@/components/production/batch-list";
import { BATCH_STATE_LABELS } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BATCH_STATES, type BatchState } from "@/modules/production/schemas";
import { getBatchListAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Master batches" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

/** The filter chips, in the order a batch goes through them. */
const STATE_CHIPS: ReadonlyArray<BatchState> = ["ACTIVE", "PLANNED", "EMPTY", "DONE"];

/**
 * Master batches, newest first (production.view, like GET /api/production/batches):
 * each an umbrella over styles made together, with its days, pieces and, for
 * people who see costs, its cost so far and cost guard. Starting one is offered
 * to production.manage, the permission createBatchAction checks.
 */
export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const query = await searchParams;
  const stateText = one(query.state);
  const state = BATCH_STATES.find((s) => s === stateText);
  const search = one(query.search)?.slice(0, 100);
  const filters = { ...(state ? { state } : {}), ...(search ? { search } : {}) };
  const result = await getBatchListAction(filters);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError title="Batches" heading="The batches could not load" error={result.error} />
    );
  }
  const { items, nextCursor, canCreate } = result.data;
  const chipHref = (s?: BatchState) => {
    const params = new URLSearchParams();
    if (s) params.set("state", s);
    if (search) params.set("search", search);
    const text = params.toString();
    return text ? `/production/batches?${text}` : "/production/batches";
  };

  return (
    <section aria-labelledby="batches-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="batches-heading" className="font-serif text-2xl text-primary">
            Master batches
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Styles made together under one batch: each style keeps its own colours and sizes, target
            price and costs, and the batch adds them up.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/production/batches/new">
              <PlusIcon aria-hidden />
              New batch
            </Link>
          </Button>
        )}
      </div>

      {one(query.deleted) === "1" && <FormAlert tone="success">The batch was deleted.</FormAlert>}

      <div className="grid gap-3">
        <form action="/production/batches" className="flex gap-2" role="search">
          {state && <input type="hidden" name="state" value={state} />}
          <label htmlFor="batch-search" className="sr-only">
            Find a batch
          </label>
          <Input
            id="batch-search"
            name="search"
            defaultValue={search ?? ""}
            placeholder="Batch code or name, a style or the factory"
            autoComplete="off"
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline">
            <SearchIcon aria-hidden />
            Find
          </Button>
        </form>
        <nav aria-label="Batch state" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {[undefined, ...STATE_CHIPS].map((s) => (
            <Link
              key={s ?? "all"}
              href={chipHref(s)}
              aria-current={state === s ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                state === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {s ? BATCH_STATE_LABELS[s] : "All"}
            </Link>
          ))}
        </nav>
      </div>

      {items.length === 0 ? (
        state || search ? (
          <EmptyState title="No batches match">
            Try a batch code, part of its name, a style or the factory, or show all.
          </EmptyState>
        ) : (
          <EmptyState
            title="No master batches yet"
            action={
              canCreate ? (
                <Button asChild>
                  <Link href="/production/batches/new">Start the first batch</Link>
                </Button>
              ) : undefined
            }
          >
            A batch puts the styles made together in one place, like 5,000 polo shirts in three
            brands at one factory.
          </EmptyState>
        )
      ) : (
        <BatchList
          key={`${state ?? ""}:${search ?? ""}`}
          initial={{ items, nextCursor }}
          query={filters}
          currency={ctx.company.currency}
        />
      )}
    </section>
  );
}
