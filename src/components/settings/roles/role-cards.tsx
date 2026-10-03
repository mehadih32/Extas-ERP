import { BanknoteIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { RoleSummary } from "@/modules/rbac/role.service";

import { isMoneyPermission, PERMISSION_COUNT, roleSummary } from "./role-labels";

/** The company's roles as cards: what each is for, how many people hold it and how much it allows. */
export function RoleCards({ roles }: { roles: RoleSummary[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {roles.map((role) => {
        const summary = roleSummary(role);
        const all = role.systemRole === "SUPER_ADMIN";
        return (
          <li key={role.id}>
            <Link
              href={`/settings/roles/${role.id}`}
              className="flex h-full flex-col rounded-lg border bg-card p-5 transition-[border-color,box-shadow] outline-none hover:border-primary/40 focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/15"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={role.isSystem ? "secondary" : "outline"}>
                  {role.isSystem ? "Built-in" : "Custom"}
                </Badge>
                {role.permissions.some(isMoneyPermission) && (
                  <Badge variant="outline">
                    <BanknoteIcon aria-hidden />
                    Records money
                  </Badge>
                )}
              </span>
              <span className="mt-3 font-serif text-xl leading-tight text-primary">
                {role.name}
              </span>
              {summary && (
                <span className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {summary}
                </span>
              )}
              <span className="mt-auto flex gap-8 pt-5 text-sm">
                <span>
                  <span className="eyebrow block">People</span>
                  <span className="mt-1 block font-serif text-lg tabular-nums">
                    {role.memberCount}
                  </span>
                </span>
                <span>
                  <span className="eyebrow block">Permissions</span>
                  <span className="mt-1 block font-serif text-lg tabular-nums">
                    {all ? "All" : `${role.permissions.length} of ${PERMISSION_COUNT}`}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
