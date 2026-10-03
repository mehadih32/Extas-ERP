"use client";

import { KeyRoundIcon, LogOutIcon, UserRoundIcon } from "lucide-react";
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

import type { ShellUser } from "./types";

/**
 * The person's menu: who is signed in and in which role, change password and
 * sign out. An initials button in the top bar, the "Account" tab on phones.
 */
export function UserMenu({
  user,
  companyName,
  variant,
  className,
}: {
  user: ShellUser;
  companyName: string;
  variant: "avatar" | "tab";
  className?: string;
}) {
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
        ) : (
          <DropdownMenuTrigger
            className={cn(
              "flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 text-[0.6875rem] tracking-[0.06em] text-muted-foreground uppercase outline-none data-[state=open]:text-primary",
              className,
            )}
          >
            <UserRoundIcon className="size-5" aria-hidden />
            Account
          </DropdownMenuTrigger>
        )}
        <DropdownMenuContent
          align="end"
          side={variant === "tab" ? "top" : "bottom"}
          className="w-[min(18rem,calc(100vw-2rem))]"
        >
          <DropdownMenuLabel className="grid gap-1 py-2.5">
            <span className="truncate font-serif text-base leading-tight">{user.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
            <span className="mt-1 truncate text-xs font-normal text-primary">
              {user.roleName} · {companyName}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
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
