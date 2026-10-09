"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isActivePath, visibleNavItems } from "./nav-items";
import type { ShellUser } from "./types";
import { UserMenu } from "./user-menu";

/** The phone's bottom navigation (blueprint: mobile friendly), above the home bar. */
export function BottomNav({
  permissions,
  user,
  companyName,
}: {
  permissions: string[];
  user: ShellUser;
  companyName: string;
}) {
  const pathname = usePathname();
  const items = visibleNavItems(permissions);

  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 md:hidden"
    >
      <ul
        className="grid h-16"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-[0.625rem] tracking-[0.02em] uppercase transition-colors min-[400px]:text-[0.6875rem] min-[400px]:tracking-[0.06em]",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-primary" />
                )}
                <Icon className="size-5" aria-hidden />
                {item.shortLabel ?? item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <UserMenu user={user} companyName={companyName} variant="tab" />
        </li>
      </ul>
    </nav>
  );
}
