"use client";

import { BellIcon, LifeBuoyIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { CompanySwitcher } from "./company-switcher";
import { isActivePath, visibleNavItems } from "./nav-items";
import { SIDEBAR_COOKIE, type SidebarMode } from "./sidebar-state";
import type { ShellCompany, ShellUser } from "./types";
import { UserMenu } from "./user-menu";

/* Tailwind needs whole class names, so each mode spells out its own. */

/** The menu's width: icons only (4.5rem) or with names (16rem). */
const WIDTH: Record<SidebarMode, string> = {
  auto: "w-[4.5rem] lg:w-64",
  collapsed: "w-[4.5rem]",
  expanded: "w-64",
};

/** Names and the company switcher: shown only while the menu is wide. */
const WIDE_ONLY: Record<SidebarMode, string> = {
  auto: "hidden lg:flex",
  collapsed: "hidden",
  expanded: "flex",
};

/** The house mark when the menu is narrow: a monogram. */
const NARROW_ONLY: Record<SidebarMode, string> = {
  auto: "flex lg:hidden",
  collapsed: "flex",
  expanded: "hidden",
};

const LARGE = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(LARGE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the screen is computer-sized (where "auto" means wide). */
function useLargeScreen() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(LARGE).matches,
    () => false,
  );
}

const itemClass =
  "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30";
const IDLE =
  "text-primary-foreground/70 hover:bg-primary-foreground/8 hover:text-primary-foreground";
const ACTIVE = "bg-primary-foreground/12 font-medium text-primary-foreground";

/**
 * The modern look's side menu (tablets and computers; phones keep the bottom
 * tab bar): every section the person's role opens, the company switcher, the
 * inbox, the Help Center and their account. It narrows to icons and back, and
 * the choice is remembered on this device.
 */
export function Sidebar({
  permissions,
  user,
  companies,
  activeCompany,
  unread,
  initialMode,
}: {
  permissions: string[];
  user: ShellUser;
  companies: ShellCompany[];
  activeCompany: { id: string; name: string };
  unread: number;
  /** The choice saved on this device (SIDEBAR_COOKIE), read by the server. */
  initialMode: SidebarMode;
}) {
  const pathname = usePathname();
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  const large = useLargeScreen();
  const wide = mode === "expanded" || (mode === "auto" && large);
  const items = visibleNavItems(permissions);
  const inboxLabel = unread > 0 ? `Inbox, ${unread} unread` : "Inbox";

  function toggle() {
    const next: SidebarMode = wide ? "collapsed" : "expanded";
    setMode(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      aria-label="Side menu"
      className={cn(
        "sticky top-0 z-30 hidden h-dvh shrink-0 flex-col bg-primary text-primary-foreground transition-[width] duration-200 md:flex print:hidden",
        WIDTH[mode],
      )}
    >
      <div className="flex h-16 shrink-0 items-center gap-2 px-4">
        <Link
          href={ROUTES.home}
          aria-label="Extas ERP, dashboard"
          className="min-w-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30"
        >
          <Wordmark className={WIDE_ONLY[mode]} />
          <span
            aria-hidden
            className={cn(
              "size-9 items-center justify-center rounded-md bg-primary-foreground/10 text-base font-semibold",
              NARROW_ONLY[mode],
            )}
          >
            E
          </span>
        </Link>
      </div>

      <div className={cn("shrink-0 px-3 pb-3", WIDE_ONLY[mode])}>
        <CompanySwitcher
          companies={companies}
          activeCompany={activeCompany}
          className="w-full max-w-none justify-start sm:max-w-none md:max-w-none lg:max-w-none [&>span]:flex-1 [&>span]:text-left"
        />
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  title={wide ? undefined : item.label}
                  className={cn(itemClass, active ? ACTIVE : IDLE)}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary-foreground"
                    />
                  )}
                  <Icon className="size-[1.125rem] shrink-0" aria-hidden />
                  <span className={cn("truncate", WIDE_ONLY[mode])}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="grid shrink-0 gap-0.5 border-t border-primary-foreground/10 px-3 py-3">
        <Link
          href="/inbox"
          aria-label={inboxLabel}
          title={wide ? undefined : inboxLabel}
          aria-current={isActivePath(pathname, "/inbox") ? "page" : undefined}
          className={cn(itemClass, isActivePath(pathname, "/inbox") ? ACTIVE : IDLE)}
        >
          <span className="relative shrink-0">
            <BellIcon className="size-[1.125rem]" aria-hidden />
            {unread > 0 && (
              <span
                aria-hidden
                className="absolute -top-1.5 -right-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] leading-none font-semibold text-destructive-foreground tabular-nums ring-2 ring-primary"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          <span className={cn("truncate", WIDE_ONLY[mode])}>Inbox</span>
        </Link>
        <Link
          href={ROUTES.help}
          aria-label="Help Center"
          title={wide ? undefined : "Help Center"}
          aria-current={isActivePath(pathname, ROUTES.help) ? "page" : undefined}
          className={cn(itemClass, isActivePath(pathname, ROUTES.help) ? ACTIVE : IDLE)}
        >
          <LifeBuoyIcon className="size-[1.125rem] shrink-0" aria-hidden />
          <span className={cn("truncate", WIDE_ONLY[mode])}>Help Center</span>
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={wide}
          aria-label={wide ? "Narrow the menu to icons" : "Widen the menu"}
          title={wide ? "Narrow the menu to icons" : "Widen the menu"}
          className={cn(itemClass, IDLE, "w-full cursor-pointer")}
        >
          {wide ? (
            <PanelLeftCloseIcon className="size-[1.125rem] shrink-0" aria-hidden />
          ) : (
            <PanelLeftOpenIcon className="size-[1.125rem] shrink-0" aria-hidden />
          )}
          <span className={cn("truncate", WIDE_ONLY[mode])}>Narrow the menu</span>
        </button>
        <div className="mt-2">
          <UserMenu
            user={user}
            companyName={activeCompany.name}
            variant="sidebar"
            labelClassName={WIDE_ONLY[mode]}
          />
        </div>
      </div>
    </aside>
  );
}
