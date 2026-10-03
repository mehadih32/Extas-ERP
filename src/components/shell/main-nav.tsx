"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { isActivePath, visibleNavItems } from "./nav-items";

/** The section links in the top bar (computers and tablets). */
export function MainNav({ permissions, className }: { permissions: string[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("items-stretch gap-6 self-stretch", className)}>
      {visibleNavItems(permissions).map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center border-b-2 pt-0.5 text-[0.8125rem] tracking-[0.08em] uppercase transition-colors",
              active
                ? "border-primary-foreground text-primary-foreground"
                : "border-transparent text-primary-foreground/65 hover:text-primary-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
