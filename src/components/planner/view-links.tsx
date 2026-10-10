import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A row of links that switch between views of one page ("7 days", "14 days";
 * the notepad's tabs), the current one marked. Each is a full-height tap target
 * on phones; with `fill` they share the row's width there.
 */
export function ViewLinks({
  label,
  links,
  fill = false,
}: {
  /** What the links choose, for screen readers ("How far ahead"). */
  label: string;
  links: Array<{ href: string; label: string; current: boolean }>;
  fill?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(fill ? "grid w-full sm:inline-flex sm:w-auto" : "inline-flex")}
    >
      <ul
        className={cn(
          "gap-0.5 rounded-md border bg-muted/40 p-0.5 text-sm",
          fill ? "grid auto-cols-fr grid-flow-col sm:inline-flex" : "inline-flex",
        )}
      >
        {links.map((link) => (
          <li key={link.href} className="min-w-0">
            <Link
              href={link.href}
              scroll={false}
              aria-current={link.current ? "page" : undefined}
              className={cn(
                "flex h-10 items-center justify-center rounded-sm px-3 text-center leading-tight whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 md:h-8",
                link.current
                  ? "bg-card font-medium text-primary shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
