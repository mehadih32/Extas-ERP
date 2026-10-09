"use client";

import { XIcon } from "lucide-react";

import { SearchList } from "@/components/sales/pickers";
import { Button } from "@/components/ui/button";
import type { PartyOption, ProjectOption, StyleOption } from "@/modules/production/screens.service";
import {
  findProductionPartiesAction,
  findProductionStylesAction,
  findProjectsAction,
} from "@/server/actions/production.actions";

import { PROJECT_STATUS_LABELS, STAGE_LABELS } from "./labels";

/** The record chosen, with "Change" (or nothing to press when it is locked). */
function Chosen({
  title,
  detail,
  noun,
  locked,
  onClear,
}: {
  title: string;
  detail?: string;
  /** What it is, for the button's name ("the factory"). */
  noun: string;
  locked?: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {detail && <p className="truncate text-[0.8125rem] text-muted-foreground">{detail}</p>}
      </div>
      {!locked && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label={`Change ${noun} (${title})`}
        >
          <XIcon aria-hidden />
          Change
        </Button>
      )}
    </div>
  );
}

/**
 * A supplier (the factory, a fabric mill) or a buyer: the chosen one with
 * "Change", or a search over open accounts. Walk-in customers is never offered.
 */
export function PartyPicker({
  id,
  kind,
  value,
  onChange,
  invalid,
  describedBy,
  locked = false,
  autoFocus,
}: {
  id: string;
  kind: "SUPPLIER" | "BUYER";
  value: { id: string; code: string; name: string } | null;
  onChange: (party: PartyOption | null) => void;
  invalid?: boolean;
  describedBy?: string;
  locked?: boolean;
  autoFocus?: boolean;
}) {
  const noun = kind === "SUPPLIER" ? "the supplier" : "the buyer";
  if (value) {
    return (
      <Chosen
        title={value.name}
        detail={value.code}
        noun={noun}
        locked={locked}
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <SearchList<PartyOption>
      id={id}
      label={kind === "SUPPLIER" ? "Find a supplier" : "Find a buyer"}
      placeholder="Name, code or phone"
      invalid={invalid}
      describedBy={describedBy}
      autoFocus={autoFocus}
      search={async (text) => {
        const result = await findProductionPartiesAction({ kind, search: text });
        return result.ok ? result.data : result.error.message;
      }}
      onPick={onChange}
      renderOption={(p) => (
        <span className="grid gap-0.5">
          <span className="truncate text-sm font-medium">{p.name}</span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {[p.code, p.phone, p.city].filter(Boolean).join(" · ")}
          </span>
        </span>
      )}
    />
  );
}

/**
 * A production project: any open one for a bill or a cost, or one that is in
 * production or on hold to receive goods for.
 */
export function ProjectPicker({
  id,
  purpose,
  value,
  onChange,
  exclude = [],
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  purpose: "COST" | "RECEIVE";
  value: { id: string; code: string; name: string } | null;
  onChange: (project: ProjectOption | null) => void;
  exclude?: string[];
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  if (value) {
    return (
      <Chosen
        title={value.code}
        detail={value.name}
        noun="the project"
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <SearchList<ProjectOption>
      id={id}
      label="Find a project"
      placeholder="Project code, name or buyer"
      invalid={invalid}
      describedBy={describedBy}
      autoFocus={autoFocus}
      search={async (text) => {
        const result = await findProjectsAction({ search: text, purpose });
        if (!result.ok) return result.error.message;
        return result.data.filter((p) => !exclude.includes(p.id));
      }}
      onPick={onChange}
      renderOption={(p) => (
        <span className="grid gap-0.5">
          <span className="truncate text-sm font-medium">
            {p.code} · {p.name}
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {[p.buyerLabel, PROJECT_STATUS_LABELS[p.status], STAGE_LABELS[p.stage]].join(" · ")}
          </span>
        </span>
      )}
    />
  );
}

/** A style to make or receive: the chosen one with "Change", or a search by code or name. */
export function ProductionStylePicker({
  id,
  label = "Find a style",
  value,
  onChange,
  exclude = [],
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  label?: string;
  /** The chosen style; leave undefined for a search that only hands back what is picked. */
  value?: { id: string; code: string; name: string } | null;
  onChange: (style: StyleOption | null) => void;
  exclude?: string[];
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  if (value) {
    return (
      <Chosen
        title={`${value.code} · ${value.name}`}
        noun="the style"
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <SearchList<StyleOption>
      id={id}
      label={label}
      placeholder="Style code or name"
      invalid={invalid}
      describedBy={describedBy}
      autoFocus={autoFocus}
      search={async (text) => {
        const result = await findProductionStylesAction({ search: text });
        if (!result.ok) return result.error.message;
        return result.data.filter((s) => !exclude.includes(s.id));
      }}
      onPick={onChange}
      renderOption={(s) => (
        <span className="grid gap-0.5">
          <span className="truncate text-sm font-medium">
            {s.code} · {s.name}
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {s.skuCount} {s.skuCount === 1 ? "SKU" : "SKUs"}
          </span>
        </span>
      )}
    />
  );
}
