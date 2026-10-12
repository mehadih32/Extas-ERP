import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { GiveItemButton, ItemList } from "@/components/hr/asset-bits";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { ViewLinks } from "@/components/planner/view-links";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ASSET_SHOWS } from "@/modules/hr/schemas";
import { getAssetsScreenAction } from "@/server/actions/hr.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Company items" };

const SHOW_LABELS: Record<(typeof ASSET_SHOWS)[number], string> = {
  out: "With staff",
  returned: "Back",
  all: "All",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Company items in staff hands (any HR key reads, hr.manage changes): laptops,
 * phones, SIMs, ID cards, keys, uniforms, tools and vehicles, who has each one
 * since when, and what came back (good, damaged or lost). Items still out hold
 * up someone's deactivation when they leave.
 */
export default async function CompanyItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const result = await getAssetsScreenAction({ show: one(params.show), q: one(params.q) });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError
        title="Company items"
        heading="The company items could not load"
        error={result.error}
      />
    );
  }
  const s = result.data;
  const currency = ctx.company.currency;

  return (
    <section aria-labelledby="items-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="items-heading" className="font-serif text-2xl text-primary">
            Company items
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {s.counts.out === 0
              ? "Nothing is with staff now. Record a laptop, phone, SIM or ID card when you hand it over."
              : `${s.counts.out} ${s.counts.out === 1 ? "item is" : "items are"} with staff now.`}{" "}
            Items still out hold up someone&apos;s deactivation when they leave.
          </p>
          {s.withLeavers > 0 && (
            <p className="mt-1 text-sm text-destructive">
              {s.withLeavers} {s.withLeavers === 1 ? "item is" : "items are"} still with people who
              have left.
            </p>
          )}
        </div>
        {s.can.manage && (
          <GiveItemButton people={s.people} today={s.today} className="grid sm:justify-items-end" />
        )}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <ViewLinks
          label="Which items"
          links={ASSET_SHOWS.map((show) => ({
            href: hrHref.items({
              show: show === "out" ? undefined : show,
              q: s.q || undefined,
            }),
            label:
              show === "out"
                ? `${SHOW_LABELS[show]} (${s.counts.out})`
                : show === "returned"
                  ? `${SHOW_LABELS[show]} (${s.counts.returned})`
                  : SHOW_LABELS[show],
            current: show === s.show,
          }))}
        />
        <form method="get" className="flex gap-2" role="search">
          {s.show !== "out" && <input type="hidden" name="show" value={s.show} />}
          <Input
            name="q"
            defaultValue={s.q}
            placeholder="Item, tag or person"
            aria-label="Search the items"
            className="md:w-64"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {s.items.length === 0 ? (
        <EmptyState title={s.q ? "Nothing found" : "No items here"}>
          {s.q
            ? "No item, tag or person matches the search."
            : s.show === "out"
              ? "Company items handed to staff show here until they come back."
              : "Items that came back show here with how they came back."}
        </EmptyState>
      ) : (
        <ItemList
          items={s.items}
          today={s.today}
          manage={s.can.manage}
          showEmployee
          currency={currency}
          empty=""
        />
      )}
    </section>
  );
}
