"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { isActivePath, topBarFold, visibleNavItems } from "./nav-items";

type Fold = NonNullable<ReturnType<typeof topBarFold>>;

/* Tailwind needs whole class names, so each fold spells out its own. */

/** A section in the bar: hidden while it sits under More. */
const IN_BAR: Record<Fold, string> = {
  md: "hidden lg:inline-flex",
  lg: "hidden xl:inline-flex",
  all: "hidden",
};

/** A section under More: hidden once the bar has room for it. */
const IN_MORE: Record<Fold, string> = { md: "lg:hidden", lg: "xl:hidden", all: "" };

/** "More" itself: shown while anything sits under it. */
const MORE_SHOWN: Record<Fold, string> = {
  md: "inline-flex lg:hidden",
  lg: "inline-flex xl:hidden",
  all: "inline-flex",
};

const ACTIVE = "border-primary-foreground text-primary-foreground";
const IDLE = "border-transparent text-primary-foreground/65 hover:text-primary-foreground";

/** "More" looks current while the current section sits under it. */
const MORE_ACTIVE: Record<Fold, string> = {
  md: `${ACTIVE} lg:border-transparent lg:text-primary-foreground/65`,
  lg: `${ACTIVE} xl:border-transparent xl:text-primary-foreground/65`,
  all: ACTIVE,
};

const linkClass =
  "inline-flex items-center border-b-2 pt-0.5 text-[0.8125rem] tracking-[0.05em] whitespace-nowrap uppercase transition-colors outline-none focus-visible:text-primary-foreground lg:tracking-[0.08em]";

/**
 * The section links in the top bar (computers and tablets). Sections that do
 * not fit at the screen's width go under "More" (TOP_BAR_TABS in nav-items.ts),
 * as on the phone's tab bar.
 */
export function MainNav({ permissions, className }: { permissions: string[]; className?: string }) {
  const pathname = usePathname();
  const items = visibleNavItems(permissions);
  const lastFold = topBarFold(items.length - 1);
  const activeIndex = items.findIndex((item) => isActivePath(pathname, item.href));
  const activeFold = activeIndex >= 0 ? topBarFold(activeIndex) : null;
  const folded = items.flatMap((item, index) => {
    const fold = topBarFold(index);
    return fold ? [{ item, fold }] : [];
  });

  return (
    <nav aria-label="Main" className={cn("items-stretch gap-3.5 self-stretch lg:gap-6", className)}>
      {items.map((item, index) => {
        const active = index === activeIndex;
        const fold = topBarFold(index);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(linkClass, active ? ACTIVE : IDLE, fold && IN_BAR[fold])}
          >
            {item.shortLabel ? (
              <>
                <span className="lg:hidden">{item.shortLabel}</span>
                <span className="hidden lg:inline">{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </Link>
        );
      })}
      {lastFold && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              linkClass,
              "cursor-pointer gap-1",
              activeFold ? MORE_ACTIVE[activeFold] : IDLE,
              MORE_SHOWN[lastFold],
            )}
          >
            More
            <ChevronDownIcon className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {folded.map(({ item, fold }) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem key={item.href} asChild className={IN_MORE[fold]}>
                  <Link
                    href={item.href}
                    aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
                  >
                    <Icon aria-hidden />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
