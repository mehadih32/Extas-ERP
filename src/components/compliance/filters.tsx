"use client";

import type { ComplianceType } from "@prisma/client";
import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  COMPLIANCE_SHOW_LABELS,
  COMPLIANCE_SHOWS,
  COMPLIANCE_TYPE_LABELS,
  COMPLIANCE_TYPES,
  complianceListSearch,
  type ComplianceListView,
  type ComplianceShow,
  isComplianceFiltered,
} from "./labels";

/**
 * The licence list's filters: in force, renew soon, expired or with the
 * history; one kind; a search over names, numbers and issuers. The old list
 * stays, dimmed, until the new one comes.
 */
export function ComplianceFilters({
  view,
  children,
}: {
  view: ComplianceListView;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);

  function show(next: ComplianceListView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${complianceListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    show({ ...shown, q: typeof value === "string" && value.trim() ? value.trim() : undefined });
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
            placeholder="Search names and numbers"
            aria-label="Search licences"
            className="pl-9"
          />
        </form>
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
          <div className="min-w-0">
            <label className="sr-only" htmlFor="compliance-show">
              Which records
            </label>
            <NativeSelect
              id="compliance-show"
              value={shown.show}
              onChange={(e) => show({ ...shown, show: e.target.value as ComplianceShow })}
            >
              {COMPLIANCE_SHOWS.map((s) => (
                <option key={s} value={s}>
                  {COMPLIANCE_SHOW_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0">
            <label className="sr-only" htmlFor="compliance-kind">
              Kind
            </label>
            <NativeSelect
              id="compliance-kind"
              value={shown.type ?? ""}
              onChange={(e) =>
                show({
                  ...shown,
                  type: (e.target.value || undefined) as ComplianceType | undefined,
                })
              }
            >
              <option value="">Every kind</option>
              {COMPLIANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {COMPLIANCE_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {isComplianceFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show({ show: "current" })}
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
