"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { activeTabHref } from "./nav-items";
import { fitTabs, type MeasuredFit, placeTabs } from "./tab-fit";

const tabClass =
  "-mb-px inline-flex shrink-0 items-center gap-1 rounded-t-sm border-b-2 pt-1 pb-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";
const IDLE = "border-transparent text-muted-foreground hover:text-foreground";
const ACTIVE = "border-primary font-medium text-primary";

/**
 * A section's tabs (Settings, Products...): an underlined row of links, like the
 * dashboard's tabs. Every tab shows whole: the ones that do not fit at the screen's
 * width go under "More" at the end of the row, and the current tab always stays in
 * the row (tab-fit.ts). Until the page has measured the row, it scrolls sideways
 * with its scroll bar showing. The layout checks (scripts/full-check/layout.mjs)
 * check every tab can be reached at every width (data-layout-*).
 */
export function SectionTabs({
  label,
  tabs,
  current: currentHref,
}: {
  /** What the tabs are for, for screen readers ("Settings"). */
  label: string;
  tabs: Array<{ href: string; label: string }>;
  /** The current tab, when it is not the one the address is under (the AI Center's groups). */
  current?: string;
}) {
  const pathname = usePathname();
  const current =
    currentHref ??
    activeTabHref(
      pathname,
      tabs.map((tab) => tab.href),
    );
  const currentIndex = tabs.findIndex((tab) => tab.href === current);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<MeasuredFit | null>(null);
  const signature = tabs.map((tab) => `${tab.href} ${tab.label}`).join("|");

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const update = () => {
      const widths = [...measure.querySelectorAll<HTMLElement>("[data-tab]")].map(
        (el) => el.getBoundingClientRect().width,
      );
      const more = measure.querySelector<HTMLElement>("[data-more]");
      const next = fitTabs({
        widths,
        available: row.clientWidth,
        more: more?.getBoundingClientRect().width ?? 0,
        gap: parseFloat(getComputedStyle(measure).columnGap) || 0,
        current: currentIndex,
      });
      setMeasured((prev) =>
        prev &&
        prev.key === signature &&
        prev.fit.shown.join() === next.shown.join() &&
        prev.fit.more.join() === next.more.join()
          ? prev
          : { key: signature, fit: next },
      );
    };
    update();
    // The row's width changes with the window, a tab's when the font has loaded.
    const observer = new ResizeObserver(update);
    observer.observe(row);
    for (const el of measure.children) observer.observe(el);
    return () => observer.disconnect();
  }, [currentIndex, signature]);

  // The tabs as measured; every tab until the row is measured for these very tabs.
  // Placed by their places in the list, so the Help reader sees each tab's own words.
  const placed = placeTabs(
    tabs.map((_, i) => i),
    measured,
    signature,
  );
  const fitted = placed.measured;
  const shown = fitted ? placed.shown.map((i) => tabs[i]!) : tabs;
  const under = placed.under.map((i) => tabs[i]!);

  return (
    <nav
      aria-label={label}
      data-layout-nav
      data-layout-expect={tabs.map((tab) => tab.href).join(" ")}
      className="relative w-full min-w-0 border-b"
    >
      {/* Every tab once more, unseen, to measure what fits. */}
      <div
        ref={measureRef}
        aria-hidden
        inert
        data-layout-ignore
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 gap-6 overflow-hidden"
      >
        {tabs.map((tab) => (
          <span key={tab.href} data-tab className={cn(tabClass, ACTIVE)}>
            {tab.label}
          </span>
        ))}
        <span data-more className={cn(tabClass, ACTIVE)}>
          More
          <ChevronDownIcon className="size-3.5" aria-hidden />
        </span>
      </div>
      <div
        ref={rowRef}
        className={cn(
          "flex w-full items-end gap-6",
          !fitted && "[scrollbar-width:thin] overflow-x-auto overflow-y-hidden",
        )}
      >
        {shown.map((tab) => {
          const active = tab.href === current;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(tabClass, active ? ACTIVE : IDLE)}
            >
              {tab.label}
            </Link>
          );
        })}
        {under.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              data-layout-more
              aria-label={`More: ${under.map((tab) => tab.label).join(", ")}`}
              className={cn(tabClass, IDLE, "cursor-pointer")}
            >
              More
              <ChevronDownIcon className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {under.map((tab) => (
                <DropdownMenuItem key={tab.href} asChild>
                  <Link href={tab.href}>{tab.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  );
}
