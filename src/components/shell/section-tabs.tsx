"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { activeTabHref } from "./nav-items";

/**
 * A section's tabs (Settings, Products): an underlined row of links, like the
 * dashboard's tabs. It scrolls sideways on phones when the tabs do not fit.
 */
export function SectionTabs({
  label,
  tabs,
}: {
  /** What the tabs are for, for screen readers ("Settings"). */
  label: string;
  tabs: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  const current = activeTabHref(
    pathname,
    tabs.map((tab) => tab.href),
  );
  return (
    <nav
      aria-label={label}
      className="flex w-full [scrollbar-width:none] items-end gap-6 overflow-x-auto border-b [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center border-b-2 pt-1 pb-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:text-foreground",
              active
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
