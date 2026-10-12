"use client";

import { BanknoteIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { isMoneyPermission, PERMISSION_GROUPS } from "@/components/settings/roles/role-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

/** Every permission, A to Z by its key, with the area of the app it belongs to. */
const AREA = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, g.label] as const)),
);
export const PERMISSIONS_AZ = [...PERMISSIONS]
  .sort((a, b) => a.key.localeCompare(b.key))
  .map((p) => ({
    key: p.key as PermissionKey,
    description: p.description,
    area: AREA.get(p.key) ?? "",
    money: isMoneyPermission(p.key),
  }));
export const PERMISSION_TOTAL = PERMISSIONS_AZ.length;

const letterOf = (key: string) => key[0]!.toUpperCase();

/**
 * The full disclosure permission matrix: every permission in the app, A to Z,
 * with a box each. Ticked is what the person may see and use; anything left
 * unticked is hidden from them. Each line says when it differs from their
 * role's ("Added" or "Taken away"). Without `onChange` it only shows.
 */
export function PermissionMatrix({
  roleName,
  roleKeys,
  selected,
  onChange,
}: {
  roleName: string;
  roleKeys: ReadonlySet<PermissionKey>;
  selected: ReadonlySet<PermissionKey>;
  onChange?: (next: Set<PermissionKey>) => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const shown = words
    ? PERMISSIONS_AZ.filter((p) =>
        `${p.key} ${p.description} ${p.area}`.toLowerCase().includes(words),
      )
    : PERMISSIONS_AZ;
  const letters = [...new Set(shown.map((p) => letterOf(p.key)))];
  const asRole = selected.size === roleKeys.size && [...roleKeys].every((k) => selected.has(k));

  const toggle = (key: PermissionKey, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    onChange?.(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a permission"
            aria-label="Find a permission"
            className="pl-9"
          />
        </div>
        {onChange && (
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(new Set(PERMISSIONS_AZ.map((p) => p.key)))}
              disabled={selected.size === PERMISSION_TOTAL}
            >
              Tick all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(new Set())}
              disabled={selected.size === 0}
            >
              Untick all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(new Set(roleKeys))}
              disabled={asRole}
            >
              As the role gives
            </Button>
          </div>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border"
        role="group"
        aria-label={`Permissions A to Z (${roleName})`}
      >
        {letters.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No permission matches “{query.trim()}”.
          </p>
        ) : (
          letters.map((letter) => (
            <section key={letter} aria-labelledby={`letter-${letter}`}>
              <h3
                id={`letter-${letter}`}
                className="sticky top-0 z-10 border-b bg-muted/90 px-4 py-1 font-mono text-xs font-medium text-muted-foreground backdrop-blur"
              >
                {letter}
              </h3>
              <ul className="divide-y">
                {shown
                  .filter((p) => letterOf(p.key) === letter)
                  .map((p) => {
                    const on = selected.has(p.key);
                    const fromRole = roleKeys.has(p.key);
                    const id = `matrix-${p.key}`;
                    return (
                      <li key={p.key}>
                        <label
                          htmlFor={id}
                          // relative: the checkbox's hidden form input stays inside the list
                          // instead of stretching the window it scrolls in.
                          className={cn(
                            "relative flex min-h-12 items-start gap-3 px-4 py-2.5 transition-colors",
                            onChange && "cursor-pointer hover:bg-muted/40",
                          )}
                        >
                          <Checkbox
                            id={id}
                            checked={on}
                            disabled={!onChange}
                            onCheckedChange={(value) => toggle(p.key, value === true)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1 text-sm leading-relaxed">
                            <span className={cn(!on && "text-muted-foreground")}>
                              {p.description}
                            </span>
                            {p.money && (
                              <Badge variant="outline" className="ml-2 align-middle">
                                <BanknoteIcon aria-hidden />
                                Money
                              </Badge>
                            )}
                            {on && !fromRole && <Badge className="ml-2 align-middle">Added</Badge>}
                            {!on && fromRole && (
                              <Badge
                                variant="outline"
                                className="ml-2 border-destructive/40 align-middle text-destructive"
                              >
                                Taken away
                              </Badge>
                            )}
                            <span className="mt-0.5 block truncate text-[0.6875rem] text-muted-foreground">
                              {p.area} · <span className="font-mono">{p.key}</span>
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
