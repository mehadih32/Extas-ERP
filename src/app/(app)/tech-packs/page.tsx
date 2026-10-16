import { PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { RowCard } from "@/components/sales/load-more";
import { TECH_PACK_STATUS_LABELS, TECH_PACK_STATUSES } from "@/components/tech-packs/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import { listTechPacksAction } from "@/server/actions/tech-pack.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Tech Pack" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

/**
 * Every tech pack of the company, the latest change first (production.view):
 * the ones started from a buyer's brief before any order, and the ones of the
 * styles in production. Search, and filters for buyer, style, season and
 * status. "New tech pack" needs production.manage.
 */
export default async function TechPacksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const params = await searchParams;
  const asked = {
    q: one(params.q)?.slice(0, 100),
    buyer: one(params.buyer),
    style: one(params.style),
    season: one(params.season),
    status: one(params.status),
    page: one(params.page),
  };
  const result = await listTechPacksAction(asked);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Tech packs are not part of your role">
          Your administrator can give your role the permission to see production, which opens the
          tech packs.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="Tech Pack"
        heading="The tech packs could not load"
        error={result.error}
      />
    );
  }
  const { rows, filters, can, total, page, pages, query } = result.data;
  const filtered = Boolean(query.q || query.buyer || query.style || query.season || query.status);
  const pageHref = (to: number) => {
    const next = new URLSearchParams(
      Object.entries({ ...query, page: String(to) }).filter(
        (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
      ),
    );
    return `/tech-packs?${next.toString()}`;
  };

  return (
    <section aria-labelledby="tech-packs-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="tech-packs-heading" className="font-serif text-2xl text-primary">
            All tech packs
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Start a tech pack from the buyer&apos;s brief and references before any order, then link
            it to the production project when the order comes.
          </p>
        </div>
        {can.create && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={productionHref.newTechPack()}>
              <PlusIcon aria-hidden />
              New tech pack
            </Link>
          </Button>
        )}
      </div>

      <form
        action="/tech-packs"
        role="search"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]"
      >
        <label htmlFor="tech-pack-search" className="sr-only">
          Find a tech pack
        </label>
        <Input
          id="tech-pack-search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Number, title, buyer, style or project"
          autoComplete="off"
          className="min-w-0 sm:col-span-2 lg:col-span-1"
        />
        <label htmlFor="tech-pack-buyer" className="sr-only">
          Buyer
        </label>
        <NativeSelect
          id="tech-pack-buyer"
          name="buyer"
          defaultValue={query.buyer ?? ""}
          containerClassName="sm:w-full"
        >
          <option value="">All buyers</option>
          {filters.buyers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
        <label htmlFor="tech-pack-style" className="sr-only">
          Style
        </label>
        <NativeSelect
          id="tech-pack-style"
          name="style"
          defaultValue={query.style ?? ""}
          containerClassName="sm:w-full"
        >
          <option value="">All styles</option>
          {filters.styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
        </NativeSelect>
        <label htmlFor="tech-pack-season" className="sr-only">
          Season
        </label>
        <NativeSelect
          id="tech-pack-season"
          name="season"
          defaultValue={query.season ?? ""}
          containerClassName="sm:w-full"
        >
          <option value="">All seasons</option>
          {filters.seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
        <label htmlFor="tech-pack-status" className="sr-only">
          Status
        </label>
        <NativeSelect
          id="tech-pack-status"
          name="status"
          defaultValue={query.status ?? ""}
          containerClassName="sm:w-full"
        >
          <option value="">Any status</option>
          {TECH_PACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TECH_PACK_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" className="sm:col-span-2 lg:col-span-1">
          <SearchIcon aria-hidden />
          Find
        </Button>
      </form>
      {filtered && (
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "tech pack matches" : "tech packs match"}.{" "}
          <Link href="/tech-packs" className="text-primary underline-offset-4 hover:underline">
            Show all tech packs
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No tech pack matches">
            Try the tech pack number, its title, the buyer or the project code, or show all.
          </EmptyState>
        ) : (
          <EmptyState
            title="No tech packs yet"
            action={
              can.create ? (
                <Button asChild>
                  <Link href={productionHref.newTechPack()}>Start the first tech pack</Link>
                </Button>
              ) : undefined
            }
          >
            When a buyer sends a brief, photos or a link, start a tech pack from them here. A
            production project&apos;s tech pack shows here too.
          </EmptyState>
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((t) => (
            <RowCard
              key={t.id}
              href={productionHref.techPackOf(t.id)}
              eyebrow={`${t.number}${t.season ? ` · ${t.season}` : ""}`}
              badges={
                <Badge variant={t.status === "APPROVED" ? "default" : "outline"}>
                  {TECH_PACK_STATUS_LABELS[t.status]}
                </Badge>
              }
              title={t.title || t.number}
              details={[
                t.buyer ?? "No buyer yet",
                t.style ? `${t.style.code} · ${t.style.name}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              footer={
                <>
                  <span className="min-w-0 break-words">
                    {t.project
                      ? `${t.project.code} · ${t.project.name}`
                      : "No production project yet"}
                  </span>
                  <span className="text-muted-foreground">Updated {formatDay(t.updatedOn)}</span>
                </>
              }
            />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)}>Previous</Link>
              </Button>
            )}
            {page < pages && (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page + 1)}>Next</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}
