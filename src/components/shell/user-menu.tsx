"use client";

import {
  ChevronsUpDownIcon,
  IdCardIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MenuIcon,
  PaletteIcon,
  UserRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionError } from "@/lib/result";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/server/actions/auth-forms.actions";

import type { NavItem } from "./nav-items";
import type { ShellUser } from "./types";

/**
 * The person's menu: who is signed in and in which role, their own HR records
 * (for people whose menu has HR & payroll instead), the Help Center, their
 * look (Appearance), change password and sign out. An initials button in the
 * top bar, the "Account" tab on phones, and the person's row at the foot of the
 * modern side menu. When the phone's tab bar has more sections than fit, the
 * tab is "More" and lists those sections first.
 */
export function UserMenu({
  user,
  companyName,
  variant,
  className,
  labelClassName,
  sections = [],
  activeSection = false,
}: {
  user: ShellUser;
  companyName: string;
  variant: "avatar" | "tab" | "sidebar";
  className?: string;
  /** The side menu's name and role next to the initials (hidden while it is narrow). */
  labelClassName?: string;
  /** Sections that did not fit in the phone's tab bar. */
  sections?: NavItem[];
  /** One of those sections is the current page. */
  activeSection?: boolean;
}) {
  const more = variant === "tab" && sections.length > 0;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  return (
    <>
      <DropdownMenu>
        {variant === "avatar" ? (
          <DropdownMenuTrigger
            aria-label={`Account: ${user.name}`}
            className={cn(
              "inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-primary-foreground text-[0.75rem] font-semibold tracking-wider text-primary transition-shadow outline-none hover:ring-[3px] hover:ring-primary-foreground/25 focus-visible:ring-[3px] focus-visible:ring-primary-foreground/40",
              className,
            )}
          >
            {user.initials}
          </DropdownMenuTrigger>
        ) : variant === "sidebar" ? (
          <DropdownMenuTrigger
            aria-label={`Account: ${user.name}`}
            className={cn(
              "flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md p-1.5 text-left text-primary-foreground transition-colors outline-none hover:bg-primary-foreground/10 focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30 data-[state=open]:bg-primary-foreground/10",
              className,
            )}
          >
            <span
              aria-hidden
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-[0.6875rem] font-semibold tracking-wider text-primary"
            >
              {user.initials}
            </span>
            <span className={cn("min-w-0 flex-1 flex-col", labelClassName)}>
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-primary-foreground/65">
                {user.roleName}
              </span>
            </span>
            <ChevronsUpDownIcon
              className={cn("size-4 shrink-0 opacity-60", labelClassName)}
              aria-hidden
            />
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            aria-label={
              more ? `More: ${sections.map((s) => s.label).join(", ")} and your account` : undefined
            }
            className={cn(
              "relative flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 text-[0.625rem] tracking-[0.02em] uppercase outline-none data-[state=open]:text-primary min-[400px]:text-[0.6875rem] min-[400px]:tracking-[0.06em]",
              activeSection ? "text-primary" : "text-muted-foreground",
              className,
            )}
          >
            {activeSection && (
              <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-primary" />
            )}
            {more ? (
              <MenuIcon className="size-5" aria-hidden />
            ) : (
              <UserRoundIcon className="size-5" aria-hidden />
            )}
            {more ? "More" : "Account"}
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          align="end"
          side={variant === "tab" ? "top" : variant === "sidebar" ? "right" : "bottom"}
          className="w-[min(18rem,calc(100vw-2rem))]"
        >
          {more && (
            <>
              <DropdownMenuGroup>
                {sections.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href}>
                        <Icon aria-hidden />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel className="grid gap-1 py-2.5">
            <span className="truncate font-serif text-base leading-tight">{user.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
            <span className="mt-1 truncate text-xs font-normal text-primary">
              {user.roleName} · {companyName}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {user.myHr && (
              <DropdownMenuItem asChild>
                <Link href={ROUTES.myHr}>
                  <IdCardIcon aria-hidden />
                  My HR
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={ROUTES.help}>
                <LifeBuoyIcon aria-hidden />
                Help Center
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={ROUTES.appearance}>
                <PaletteIcon aria-hidden />
                Appearance
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={ROUTES.changePassword}>
                <KeyRoundIcon aria-hidden />
                Change password
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={pending}
            onSelect={() => startTransition(async () => setError(await signOutAction()))}
          >
            <LogOutIcon aria-hidden />
            {pending ? "Signing out" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionErrorDialog
        error={error}
        title="You are still signed in"
        onClose={() => setError(undefined)}
      />
    </>
  );
}
