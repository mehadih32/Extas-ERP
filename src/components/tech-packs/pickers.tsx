"use client";

import { XIcon } from "lucide-react";

import { SearchList } from "@/components/sales/pickers";
import { Button } from "@/components/ui/button";
import {
  findLinkableProjectsAction,
  findLinkableTechPacksAction,
  findTechPackBuyersAction,
  findTechPackStylesAction,
} from "@/server/actions/tech-pack.actions";

/*
 * The pickers of the Tech Pack pages: a buyer, a catalogue style, a style in
 * production without a tech pack, and a tech pack not linked yet. Each shows
 * the choice with a button to change it, or the search box.
 */

export type Choice = { id: string; label: string };

/** The chosen option with a way to clear it, or the search to pick one. */
function Chosen({
  value,
  onClear,
  clearLabel,
  children,
}: {
  value: Choice | null;
  onClear: () => void;
  clearLabel: string;
  children: React.ReactNode;
}) {
  if (!value) return <>{children}</>;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card p-3">
      <span className="min-w-0 text-sm break-words">{value.label}</span>
      <Button type="button" size="sm" variant="ghost" onClick={onClear} aria-label={clearLabel}>
        <XIcon aria-hidden />
        Change
      </Button>
    </div>
  );
}

const optionText = (main: string, sub?: string | null) => (
  <span className="grid min-w-0 gap-0.5">
    <span className="text-sm font-medium break-words">{main}</span>
    {sub && <span className="text-[0.8125rem] break-words text-muted-foreground">{sub}</span>}
  </span>
);

export function BuyerPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Choice | null;
  onChange: (value: Choice | null) => void;
}) {
  return (
    <Chosen value={value} onClear={() => onChange(null)} clearLabel="Change the buyer">
      <SearchList<{ id: string; code: string; name: string }>
        id={id}
        label="Find a buyer"
        placeholder="Buyer name or code"
        search={async (text) => {
          const result = await findTechPackBuyersAction(text);
          return result.ok ? result.data : result.error.message;
        }}
        onPick={(b) => onChange({ id: b.id, label: b.name })}
        renderOption={(b) => optionText(b.name, b.code)}
      />
    </Chosen>
  );
}

export function StylePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Choice | null;
  onChange: (value: Choice | null) => void;
}) {
  return (
    <Chosen value={value} onClear={() => onChange(null)} clearLabel="Change the style">
      <SearchList<{ id: string; code: string; name: string }>
        id={id}
        label="Find a style"
        placeholder="Style code or name"
        search={async (text) => {
          const result = await findTechPackStylesAction(text);
          return result.ok ? result.data : result.error.message;
        }}
        onPick={(s) => onChange({ id: s.id, label: `${s.code} · ${s.name}` })}
        renderOption={(s) => optionText(`${s.code} · ${s.name}`)}
      />
    </Chosen>
  );
}

/** Styles in production without a tech pack of their own. */
export function ProjectPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Choice | null;
  onChange: (value: Choice | null) => void;
}) {
  return (
    <Chosen value={value} onClear={() => onChange(null)} clearLabel="Change the project">
      <SearchList<{ id: string; code: string; name: string; buyer: string | null }>
        id={id}
        label="Find a production project"
        placeholder="Project code, name or buyer"
        search={async (text) => {
          const result = await findLinkableProjectsAction(text);
          return result.ok ? result.data : result.error.message;
        }}
        onPick={(p) => onChange({ id: p.id, label: `${p.code} · ${p.name}` })}
        renderOption={(p) => optionText(`${p.code} · ${p.name}`, p.buyer ?? "In-House")}
      />
    </Chosen>
  );
}

/** Tech packs not linked to a style in production yet (not approved or locked). */
export function TechPackPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Choice | null;
  onChange: (value: Choice | null) => void;
}) {
  return (
    <Chosen value={value} onClear={() => onChange(null)} clearLabel="Change the tech pack">
      <SearchList<{ id: string; number: string; title: string; buyer: string | null }>
        id={id}
        label="Find a tech pack"
        placeholder="Tech pack no., title or buyer"
        search={async (text) => {
          const result = await findLinkableTechPacksAction(text);
          return result.ok ? result.data : result.error.message;
        }}
        onPick={(t) => onChange({ id: t.id, label: `${t.number} · ${t.title}` })}
        renderOption={(t) => optionText(`${t.number} · ${t.title}`, t.buyer)}
      />
    </Chosen>
  );
}
