"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  BUYER_TYPE_LABELS,
  GRADE_LABELS,
  GRADES,
  STATUS_LABELS,
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
} from "./labels";
import { isFiltered, type PartyListView, partyListSearch } from "./list-view";

/**
 * The Buyers and Suppliers tabs' filters: search (name, code, contact person,
 * phone or email), status, grade, buyer type (buyers only), category
 * (suppliers only) and Blue Verified only. A change reloads the list from the
 * server; the old list stays, dimmed, until the new one arrives, while the
 * filters already show the choice made.
 */
export function PartyFilters({
  view,
  children,
}: {
  view: PartyListView;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The choice made, until the list for it arrives (a select or checkbox bound to
  // the address alone would spring back while it loads).
  const [shown, setShown] = useOptimistic(view);
  const buyers = shown.list === "buyers";
  const noun = buyers ? "buyers" : "suppliers";

  function show(change: Partial<PartyListView>) {
    const next = { ...shown, ...change };
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${partyListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    show({ q: typeof value === "string" ? value : "" });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        <form role="search" onSubmit={search} className="relative w-full lg:max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            key={shown.q}
            type="search"
            name="q"
            defaultValue={shown.q}
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Name, code, phone or email"
            aria-label={`Search ${noun}`}
            className="pl-9"
          />
        </form>
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
          <div>
            <label className="sr-only" htmlFor="party-status">
              Status
            </label>
            <NativeSelect
              id="party-status"
              value={shown.status ?? ""}
              onChange={(e) =>
                show({ status: (e.target.value || undefined) as PartyListView["status"] })
              }
            >
              <option value="">All statuses</option>
              {(["ACTIVE", "DORMANT", "SETTLING", "CLOSED"] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <label className="sr-only" htmlFor="party-grade">
              Grade
            </label>
            <NativeSelect
              id="party-grade"
              value={shown.grade ?? ""}
              onChange={(e) =>
                show({ grade: (e.target.value || undefined) as PartyListView["grade"] })
              }
            >
              <option value="">All grades</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  Grade {GRADE_LABELS[g]}
                </option>
              ))}
            </NativeSelect>
          </div>
          {buyers && (
            <div>
              <label className="sr-only" htmlFor="party-type">
                Buyer type
              </label>
              <NativeSelect
                id="party-type"
                value={shown.type ?? ""}
                onChange={(e) =>
                  show({ type: (e.target.value || undefined) as PartyListView["type"] })
                }
              >
                <option value="">All types</option>
                {(["WHOLESALE", "B2B_CORPORATE", "RETAIL"] as const).map((t) => (
                  <option key={t} value={t}>
                    {BUYER_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {!buyers && (
            <div>
              <label className="sr-only" htmlFor="party-category">
                Category
              </label>
              <NativeSelect
                id="party-category"
                value={shown.category ?? ""}
                onChange={(e) =>
                  show({ category: (e.target.value || undefined) as PartyListView["category"] })
                }
              >
                <option value="">All categories</option>
                {SUPPLIER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SUPPLIER_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <label className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9">
            <input
              type="checkbox"
              checked={shown.verified}
              onChange={(e) => show({ verified: e.target.checked })}
              className="size-4 cursor-pointer accent-primary"
            />
            Blue Verified only
          </label>
        </div>
        {isFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() =>
              show({
                q: "",
                status: undefined,
                grade: undefined,
                type: undefined,
                category: undefined,
                verified: false,
              })
            }
          >
            <XIcon aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
      <div
        aria-busy={pending}
        className={cn(
          "grid grid-cols-1 gap-5 transition-opacity",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {children}
      </div>
    </div>
  );
}
