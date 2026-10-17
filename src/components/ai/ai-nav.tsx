"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SectionTabs } from "@/components/shell/section-tabs";
import { cn } from "@/lib/utils";

import { type AiTab, aiNavigation } from "./tabs";

/**
 * The AI Center's menu: its groups as tabs (Mehedi & Agents, Work, Money, System),
 * and under them the current group's pages, which wrap onto a second line on a
 * phone, so every page's name shows in full at every width.
 */
export function AiNav({ tabs }: { tabs: Array<Pick<AiTab, "href" | "label" | "group">> }) {
  const pathname = usePathname();
  const { groups, active: group, current } = aiNavigation(tabs, pathname);
  if (!groups.length) return null;

  return (
    <div className="grid gap-4">
      <SectionTabs
        label="AI Center"
        tabs={groups.map(({ href, label }) => ({ href, label }))}
        current={group?.href}
      />
      {group && (
        <nav
          aria-label={`${group.label} pages`}
          data-layout-nav
          data-layout-expect={group.tabs.map((tab) => tab.href).join(" ")}
        >
          <ul className="flex flex-wrap gap-2">
            {group.tabs.map((tab) => {
              const active = tab.href === current;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active
                        ? "border-primary bg-primary font-medium text-primary-foreground"
                        : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
