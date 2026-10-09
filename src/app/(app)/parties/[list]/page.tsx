import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { PartyFilters } from "@/components/parties/party-filters";
import { PartyList } from "@/components/parties/party-list";
import {
  isFiltered,
  partyListQuery,
  partyListSearch,
  partyListViewFrom,
} from "@/components/parties/list-view";
import { listName } from "@/components/parties/route";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getPartyListAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ list: string }>;
}): Promise<Metadata> {
  const { list } = await params;
  return { title: list === "suppliers" ? "Suppliers" : "Buyers" };
}

/**
 * The buyers (buyers and accounts that are both) or the suppliers, with their
 * balance, for parties.view like GET /api/parties. Adding one is offered to
 * parties.manage, the permission createPartyAction checks.
 */
export default async function PartyListPage({
  params,
  searchParams,
}: {
  params: Promise<{ list: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ list }, query] = await Promise.all([params, searchParams]);
  const name = listName(list);
  if (!name) notFound();
  const view = partyListViewFrom(name, query);
  const result = await getPartyListAction(partyListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <PartiesNoAccess />;
    const title = name === "buyers" ? "Buyers" : "Suppliers";
    return (
      <SectionError title={title} heading={`The ${name} could not load`} error={result.error} />
    );
  }
  const { items, nextCursor, canCreate } = result.data;
  const buyers = name === "buyers";
  const noun = buyers ? "buyer" : "supplier";

  return (
    <section aria-labelledby="parties-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="parties-heading" className="font-serif text-2xl text-primary">
            {buyers ? "Buyers" : "Suppliers"}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {buyers
              ? "Everyone you sell to, with what each owes you. Open one for the full profile."
              : "The factories and suppliers you buy from, with what you owe each. Open one for the full profile."}
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/parties/${name}/new`}>
              <PlusIcon aria-hidden />
              New {noun}
            </Link>
          </Button>
        )}
      </div>

      <PartyFilters view={view}>
        {items.length === 0 ? (
          isFiltered(view) ? (
            <EmptyState title={`No ${name} match`}>
              Try part of a name, a code or a phone number, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              title={`No ${name} yet`}
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href={`/parties/${name}/new`}>Add the first {noun}</Link>
                  </Button>
                ) : undefined
              }
            >
              {buyers
                ? "Buyers show here once they are added, with what each owes."
                : "Suppliers show here once they are added, with what you owe each."}
            </EmptyState>
          )
        ) : (
          <PartyList
            key={partyListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </PartyFilters>
    </section>
  );
}
