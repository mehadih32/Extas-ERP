import { BanknoteIcon, CheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { PERMISSION_COUNT, PERMISSION_GROUPS } from "./role-labels";

/** What a role allows, group by group, for people who may look but not change it. */
export function RolePermissionList({ permissions }: { permissions: readonly string[] }) {
  const held = new Set(permissions);
  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: group.permissions.filter((p) => held.has(p.key)),
  })).filter((group) => group.permissions.length > 0);
  const missing = PERMISSION_COUNT - held.size;

  if (groups.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
        This role has no permissions yet. People in it can sign in but cannot open anything.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section
          key={group.id}
          aria-labelledby={`group-${group.id}`}
          className="rounded-lg border bg-card"
        >
          <h3 id={`group-${group.id}`} className="border-b px-5 py-3 font-serif text-lg">
            {group.label}
          </h3>
          <ul className="divide-y">
            {group.permissions.map((p) => (
              <li key={p.key} className="flex items-start gap-3 px-5 py-3 text-sm">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="leading-relaxed">{p.description}</span>
                  {p.money && (
                    <Badge variant="outline" className="ml-2 align-middle">
                      <BanknoteIcon aria-hidden />
                      Money
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {missing > 0 && (
        <p className="text-sm text-muted-foreground">
          Not included: {missing} other {missing === 1 ? "permission" : "permissions"}.
        </p>
      )}
    </div>
  );
}
