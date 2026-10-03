"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActivePath } from "@/components/shell/nav-items";
import { cn } from "@/lib/utils";

/** The settings area's tabs: an underlined row of links, like the dashboard's tabs. */
export function SettingsTabs({ tabs }: { tabs: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings"
      className="flex w-full [scrollbar-width:none] items-end gap-6 overflow-x-auto border-b [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = isActivePath(pathname, tab.href);
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
