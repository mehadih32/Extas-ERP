import {
  BanIcon,
  ChartColumnIcon,
  DownloadIcon,
  KanbanIcon,
  ListIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { LeadBoard, LeadList } from "@/components/leads/lead-list";
import { EmptyState } from "@/components/products/bits";
import { SalesNoAccess } from "@/components/sales/no-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { STAGE_LABELS, STAGE_ORDER } from "@/modules/leads/labels";
import { getLeadsPageAction } from "@/server/actions/leads.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Leads" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/**
 * Leads: companies that are not buyers yet. Staff see their own leads and the
 * ones not given to anyone; leads.all sees every lead (the service decides).
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireCompanyPage();
  const params = await searchParams;
  const filters = {
    q: one(params.q),
    stage: one(params.stage),
    owner: one(params.owner),
    sourceId: one(params.source),
    due: one(params.due) === "1" || undefined,
    archived: one(params.archived) === "1" || undefined,
  };
  const board = one(params.view) === "board";
  const result = await getLeadsPageAction(filters);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return <SectionError title="Leads" heading="The leads could not load" error={result.error} />;
  }
  const { rows, sources, people, access, currency } = result.data;
  const filtered = Object.values(filters).some(Boolean);
  const keep = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (k !== "view" && one(v) ? [[k, one(v)!]] : [])),
  );
  const viewHref = (view: "list" | "board") => {
    const next = new URLSearchParams(keep);
    if (view === "board") next.set("view", "board");
    const text = next.toString();
    return text ? `/sales/leads?${text}` : "/sales/leads";
  };

  return (
    <section aria-labelledby="leads-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 id="leads-heading" className="font-serif text-2xl text-primary">
            Leads
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Companies that are not buyers yet: where they came from, who follows them up and the
            next step. Nothing is sent from here; the buttons open your own mail or WhatsApp.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.manage && (
            <Button asChild className="w-full sm:w-auto">
              <Link href="/sales/leads/new">
                <PlusIcon aria-hidden />
                Add lead
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/sales/leads/reports">
              <ChartColumnIcon aria-hidden />
              Lead reports
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/sales/leads/do-not-contact">
              <BanIcon aria-hidden />
              Do not contact
            </Link>
          </Button>
          {access.settings && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/sales/leads/settings">
                <SettingsIcon aria-hidden />
                Lead settings
              </Link>
            </Button>
          )}
          {access.export && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <a href="/api/sales/leads/export">
                <DownloadIcon aria-hidden />
                Download list
              </a>
            </Button>
          )}
        </div>
      </div>

      <form method="get" className="grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
        {board && <input type="hidden" name="view" value="board" />}
        <div className="grid gap-2">
          <Label htmlFor="leads-q">Search</Label>
          <Input
            id="leads-q"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Company, number, country, contact"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leads-stage">Stage</Label>
          <NativeSelect
            id="leads-stage"
            name="stage"
            defaultValue={filters.stage ?? ""}
            containerClassName="sm:w-full"
          >
            <option value="">Every stage</option>
            {STAGE_ORDER.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leads-owner">Followed by</Label>
          <NativeSelect
            id="leads-owner"
            name="owner"
            defaultValue={filters.owner ?? ""}
            containerClassName="sm:w-full"
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Nobody yet</option>
            {access.all &&
              people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="leads-source">Source</Label>
          <NativeSelect
            id="leads-source"
            name="source"
            defaultValue={filters.sourceId ?? ""}
            containerClassName="sm:w-full"
          >
            <option value="">Every source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="due" value="1" defaultChecked={Boolean(filters.due)} />
            Follow-up due
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="archived"
              value="1"
              defaultChecked={Boolean(filters.archived)}
            />
            Archived
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:justify-end">
          <Button type="submit">Filter</Button>
          {filtered && (
            <Button asChild variant="outline">
              <Link href={board ? "/sales/leads?view=board" : "/sales/leads"}>Clear</Link>
            </Button>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length === 1 ? "1 lead" : `${rows.length} leads`}
          {access.all ? "" : " (yours and those not given to anyone)"}
        </p>
        <div className="flex gap-2" role="group" aria-label="View">
          <Button asChild size="sm" variant={board ? "outline" : "default"}>
            <Link href={viewHref("list")} aria-current={board ? undefined : "page"}>
              <ListIcon aria-hidden />
              List
            </Link>
          </Button>
          <Button asChild size="sm" variant={board ? "default" : "outline"}>
            <Link href={viewHref("board")} aria-current={board ? "page" : undefined}>
              <KanbanIcon aria-hidden />
              Board
            </Link>
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No leads match">Try other words, or clear the filters.</EmptyState>
        ) : (
          <EmptyState
            title="No leads yet"
            action={
              access.manage ? (
                <Button asChild>
                  <Link href="/sales/leads/new">Add the first lead</Link>
                </Button>
              ) : undefined
            }
          >
            Add the companies you met at a fair, were referred to or found yourself.
          </EmptyState>
        )
      ) : board ? (
        <LeadBoard rows={rows} currency={currency} />
      ) : (
        <LeadList rows={rows} currency={currency} />
      )}
    </section>
  );
}
