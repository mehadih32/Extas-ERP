"use client";

import { BanknoteIcon, CheckIcon, ChevronRightIcon, MinusIcon, SearchIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PermissionKey } from "@/modules/rbac/permissions";

import {
  ACCESS_TREE,
  type AccessBranch,
  type AccessLeaf,
  branchesOf,
  isBranch,
  leavesOf,
  permissionDescription,
  searchTree,
  tickNode,
  tickState,
  type TickState,
} from "./access-tree";
import { isMoneyPermission } from "./role-labels";

type Props = {
  selected: ReadonlySet<PermissionKey>;
  /** Without it the tree only shows. */
  onChange?: (next: Set<PermissionKey>) => void;
  /**
   * What the person's role gives: lines that differ say "Added" or "Taken away",
   * and "As the role gives" puts the role's ticks back.
   */
  baseline?: ReadonlySet<PermissionKey>;
  /** Names the tree for screen readers ("Permissions for Rahim Uddin"). */
  label: string;
  /**
   * From tablet width up, scrolls inside its own box (in a dialog) so the dialog's
   * buttons stay in view. On phones the whole dialog scrolls instead: one scroll,
   * and the tree is never squeezed into a few lines.
   */
  scroll?: boolean;
};

type Shared = {
  selected: ReadonlySet<PermissionKey>;
  onChange?: (next: Set<PermissionKey>) => void;
  baseline?: ReadonlySet<PermissionKey>;
  isOpen: (id: string) => boolean;
  toggleOpen: (id: string) => void;
  prefix: string;
};

const ALL_BRANCH_IDS = branchesOf(ACCESS_TREE).map((b) => b.id);

/** Added and taken away (against the role) among these actions. */
function differences(leaves: AccessLeaf[], shared: Shared) {
  const { selected, baseline } = shared;
  if (!baseline) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const { key } of leaves) {
    if (selected.has(key) && !baseline.has(key)) added++;
    if (!selected.has(key) && baseline.has(key)) removed++;
  }
  return { added, removed };
}

/**
 * The access tree: every permission as an action under its area of the app
 * (Main area > sub-area > ... > action). Ticking an area ticks everything in
 * it; its arrow opens it to tick only some of it. An area's box is ticked when
 * all of it is allowed, shows a dash when some of it is, and is empty when none
 * is. Used for roles (Settings > Roles) and for one person's access (Team, HR).
 */
export function AccessTree({ selected, onChange, baseline, label, scroll = false }: Props) {
  const prefix = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const searching = query.trim().length > 0;
  const shown = useMemo(() => searchTree(ACCESS_TREE, query) as AccessBranch[], [query]);
  const asRole =
    baseline !== undefined &&
    selected.size === baseline.size &&
    [...baseline].every((k) => selected.has(k));

  const shared: Shared = {
    selected,
    onChange,
    baseline,
    prefix,
    // While searching, every area with a match stays open.
    isOpen: (id) => searching || open.has(id),
    toggleOpen: (id) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };

  return (
    <div className={cn("flex flex-col gap-3", scroll && "sm:min-h-0 sm:flex-1")}>
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
            placeholder="Find: booking, payroll, invoice…"
            aria-label="Find a permission"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(new Set(ALL_BRANCH_IDS))}
            disabled={searching || open.size === ALL_BRANCH_IDS.length}
          >
            Open all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(new Set())}
            disabled={searching || open.size === 0}
          >
            Close all
          </Button>
          {onChange && baseline && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(new Set(baseline))}
              disabled={asRole}
            >
              As the role gives
            </Button>
          )}
        </div>
      </div>
      <p
        className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-muted-foreground"
        aria-hidden
      >
        <span className="inline-flex items-center gap-1.5">
          <LegendBox state="all" />
          allowed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LegendBox state="some" />
          some of it allowed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LegendBox state="none" />
          not allowed
        </span>
      </p>

      <div
        className={cn(
          "rounded-lg border bg-card p-1.5 sm:p-2",
          scroll && "sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:overscroll-contain",
        )}
      >
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No permission matches “{query.trim()}”.
          </p>
        ) : (
          <ul aria-label={label} className="grid">
            {shown.map((node) => (
              <BranchRow key={node.id} node={node} depth={0} shared={shared} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A box as the tree draws it, for the legend. */
function LegendBox({ state }: { state: TickState }) {
  return (
    <span
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-[3px] border",
        state === "none"
          ? "border-input bg-card"
          : "border-primary bg-primary text-primary-foreground",
      )}
    >
      {state === "all" && <CheckIcon className="size-3.5" />}
      {state === "some" && <MinusIcon className="size-3.5" />}
    </span>
  );
}

function BranchRow({ node, depth, shared }: { node: AccessBranch; depth: number; shared: Shared }) {
  const { selected, onChange, prefix } = shared;
  const leaves = leavesOf(node);
  const state = tickState(node, selected);
  const on = leaves.filter((l) => selected.has(l.key)).length;
  const open = shared.isOpen(node.id);
  const money = leaves.some((l) => isMoneyPermission(l.key));
  const { added, removed } = differences(leaves, shared);
  const id = `${prefix}-${node.id}`;
  const changes = [added > 0 && `${added} added`, removed > 0 && `${removed} taken away`].filter(
    Boolean,
  );
  return (
    <li>
      {/* relative: the checkbox's hidden form input stays inside the row. */}
      <div className="relative flex min-h-11 items-center gap-1.5 rounded-md pr-2 transition-colors hover:bg-muted/40 sm:gap-2">
        <button
          type="button"
          onClick={() => shared.toggleOpen(node.id)}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-label={`${open ? "Close" : "Open"} ${node.label}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:size-9"
        >
          <ChevronRightIcon
            className={cn("size-4 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
        <Checkbox
          id={`${id}-box`}
          checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
          disabled={!onChange}
          onCheckedChange={() => onChange?.(tickNode(node, selected, state !== "all"))}
          aria-describedby={`${id}-count`}
        />
        <label
          htmlFor={`${id}-box`}
          className={cn(
            "min-w-0 flex-1 py-2 text-sm leading-snug break-words",
            depth === 0 && "font-medium",
            onChange && "cursor-pointer",
          )}
        >
          {node.label}
          {changes.length > 0 && (
            <span className="block text-[0.75rem] font-normal text-muted-foreground">
              {changes.join(" · ")}
            </span>
          )}
        </label>
        {money && (
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            <BanknoteIcon aria-hidden />
            Money
          </Badge>
        )}
        <span
          id={`${id}-count`}
          className="shrink-0 text-[0.75rem] whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {on} of {leaves.length}
        </span>
      </div>
      {open && (
        <div id={`${id}-list`}>
          {node.note && (
            <p className="mb-1 ml-10 rounded-md bg-muted/40 px-3 py-2 text-[0.8125rem] leading-relaxed text-muted-foreground sm:ml-12">
              {node.note}
            </p>
          )}
          <ul className="ml-4 grid border-l border-dashed pl-0.5 sm:ml-[1.125rem] sm:pl-2">
            {node.children.map((child) =>
              isBranch(child) ? (
                <BranchRow key={child.id} node={child} depth={depth + 1} shared={shared} />
              ) : (
                <LeafRow key={child.key} leaf={child} shared={shared} />
              ),
            )}
          </ul>
        </div>
      )}
    </li>
  );
}

function LeafRow({ leaf, shared }: { leaf: AccessLeaf; shared: Shared }) {
  const { selected, onChange, baseline, prefix } = shared;
  const on = selected.has(leaf.key);
  const fromRole = baseline?.has(leaf.key);
  const id = `${prefix}-${leaf.key}`;
  return (
    <li>
      <label
        htmlFor={id}
        title={leaf.key}
        // relative: the checkbox's hidden form input stays inside the list
        // instead of stretching the box it scrolls in.
        className={cn(
          "relative flex min-h-11 items-start gap-1.5 rounded-md py-2.5 pr-2 transition-colors sm:gap-2",
          onChange && "cursor-pointer hover:bg-muted/40",
        )}
      >
        <span className="w-8 shrink-0 sm:w-9" aria-hidden />
        <Checkbox
          id={id}
          checked={on}
          disabled={!onChange}
          onCheckedChange={(value) => onChange?.(tickNode(leaf, selected, value === true))}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className={cn("break-words", !on && "text-muted-foreground")}>{leaf.label}</span>
          {isMoneyPermission(leaf.key) && (
            <Badge variant="outline" className="ml-2 align-middle">
              <BanknoteIcon aria-hidden />
              Money
            </Badge>
          )}
          {baseline && on && !fromRole && <Badge className="ml-2 align-middle">Added</Badge>}
          {baseline && !on && fromRole && (
            <Badge
              variant="outline"
              className="ml-2 border-destructive/40 align-middle text-destructive"
            >
              Taken away
            </Badge>
          )}
          <span className="mt-0.5 hidden text-[0.75rem] leading-snug text-muted-foreground sm:block">
            {permissionDescription(leaf.key)}
          </span>
        </span>
      </label>
    </li>
  );
}
