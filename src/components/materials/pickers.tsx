"use client";

import { XIcon } from "lucide-react";

import { PROJECT_STATUS_LABELS } from "@/components/production/labels";
import { SearchList } from "@/components/sales/pickers";
import { Button } from "@/components/ui/button";
import type {
  MaterialOption,
  ProjectOption,
  SupplierOption,
} from "@/modules/materials/screens.service";
import {
  findMaterialProjectsAction,
  findMaterialsAction,
  findMaterialSuppliersAction,
} from "@/server/actions/materials.actions";

import { KIND_LABELS, quantity } from "./labels";

/** The record chosen, with "Change" (or nothing to press when it is locked). */
export function Chosen({
  title,
  detail,
  noun,
  locked,
  onClear,
}: {
  title: string;
  detail?: string;
  /** What it is, for the button's name ("the supplier"). */
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
 * A raw material to order, buy or issue: a search by code, name or colour over
 * materials in use, each with what the store holds. The parent shows what is
 * picked; this only hands it back.
 */
export function MaterialPicker({
  id,
  label = "Find a material",
  currency,
  onPick,
  exclude = [],
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  label?: string;
  currency: string;
  onPick: (material: MaterialOption) => void;
  exclude?: string[];
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <SearchList<MaterialOption>
        id={id}
        label={label}
        placeholder="Code, name or colour"
        invalid={invalid}
        describedBy={describedBy}
        autoFocus={autoFocus}
        search={async (text) => {
          const result = await findMaterialsAction({ search: text });
          if (!result.ok) return result.error.message;
          return result.data.filter((m) => !exclude.includes(m.id));
        }}
        onPick={onPick}
        renderOption={(m) => (
          <span className="grid gap-0.5">
            <span className="truncate text-sm font-medium">
              {m.code} · {m.name}
            </span>
            <span className="truncate text-[0.8125rem] text-muted-foreground">
              {KIND_LABELS[m.kind]} · {quantity(m.quantity, m.unit, currency)} on hand
            </span>
          </span>
        )}
      />
    </div>
  );
}

/** The supplier: the chosen one with "Change", or a search over open supplier accounts. */
export function SupplierPicker({
  id,
  value,
  onChange,
  locked = false,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  value: { id: string; code: string; name: string } | null;
  onChange: (supplier: SupplierOption | null) => void;
  locked?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  if (value) {
    return (
      <Chosen
        title={value.name}
        detail={value.code}
        noun="the supplier"
        locked={locked}
        onClear={() => onChange(null)}
      />
    );
  }
  return (
    <SearchList<SupplierOption>
      id={id}
      label="Find a supplier"
      placeholder="Name, code or phone"
      invalid={invalid}
      describedBy={describedBy}
      autoFocus={autoFocus}
      search={async (text) => {
        const result = await findMaterialSuppliersAction({ search: text });
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

/** An open production project (planned, running or on hold) to issue to or order for. */
export function MaterialsProjectPicker({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  value: { id: string; code: string; name: string } | null;
  onChange: (project: ProjectOption | null) => void;
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
        const result = await findMaterialProjectsAction({ search: text });
        return result.ok ? result.data : result.error.message;
      }}
      onPick={onChange}
      renderOption={(p) => (
        <span className="grid gap-0.5">
          <span className="truncate text-sm font-medium">
            {p.code} · {p.name}
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {p.buyerLabel} · {PROJECT_STATUS_LABELS[p.status]}
          </span>
        </span>
      )}
    />
  );
}
