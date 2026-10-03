"use client";

import {
  EllipsisVerticalIcon,
  KeyRoundIcon,
  RotateCcwKeyIcon,
  UserCheckIcon,
  UserCogIcon,
  UserXIcon,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROUTES } from "@/lib/routes";
import type { TeamMember } from "@/modules/rbac/member.service";

export type MemberAction = "role" | "reset" | "deactivate" | "reactivate";

/** Whether the menu has anything in it for this member. */
export function hasMemberActions(member: TeamMember): boolean {
  return member.isYou || Object.values(member.can).some(Boolean);
}

/**
 * A member's actions: only the ones the server allows the person looking
 * (`member.can`). For their own row that includes changing their own password,
 * which is how they replace it (an admin cannot reset their own).
 */
export function MemberActions({
  member,
  onAction,
}: {
  member: TeamMember;
  onAction: (action: MemberAction, member: TeamMember) => void;
}) {
  if (!hasMemberActions(member)) return null;
  const { can } = member;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${member.name}`}
          className="size-10 md:size-8"
        >
          <EllipsisVerticalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {member.name}
        </DropdownMenuLabel>
        {can.changeRole && (
          <DropdownMenuItem onSelect={() => onAction("role", member)}>
            <UserCogIcon aria-hidden />
            Change role
          </DropdownMenuItem>
        )}
        {can.resetPassword && (
          <DropdownMenuItem onSelect={() => onAction("reset", member)}>
            <RotateCcwKeyIcon aria-hidden />
            Reset password
          </DropdownMenuItem>
        )}
        {member.isYou && (
          <DropdownMenuItem asChild>
            <Link href={ROUTES.changePassword}>
              <KeyRoundIcon aria-hidden />
              Change your password
            </Link>
          </DropdownMenuItem>
        )}
        {can.reactivate && (
          <DropdownMenuItem onSelect={() => onAction("reactivate", member)}>
            <UserCheckIcon aria-hidden />
            Reactivate
          </DropdownMenuItem>
        )}
        {can.deactivate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onAction("deactivate", member)}>
              <UserXIcon aria-hidden />
              Deactivate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
