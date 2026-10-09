"use client";

import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { VerifiedBadge } from "@/components/parties/badges";
import { GRADE_LABELS } from "@/components/parties/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { BuyerOption, SaleStyle } from "@/modules/sales/screens.service";
import { findBuyersAction, findSaleStylesAction } from "@/server/actions/sales.actions";

/** Waits for typing to pause before asking the server. */
const SEARCH_DELAY_MS = 250;

/**
 * A search box with the matches listed under it (the server finds them as the
 * person types). Choosing one hands it back; the list closes.
 */
function SearchList<T extends { id: string }>({
  id,
  label,
  placeholder,
  search,
  renderOption,
  onPick,
  invalid,
  describedBy,
  autoFocus,
}: {
  id: string;
  label: string;
  placeholder: string;
  search: (text: string) => Promise<T[] | string>;
  renderOption: (option: T) => React.ReactNode;
  onPick: (option: T) => void;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<T[]>([]);
  const [problem, setProblem] = useState<string>();
  const [pending, startTransition] = useTransition();
  const asked = useRef(0);
  // The parent hands a new function each render; the latest one asks.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  const listId = `${id}-options`;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const ask = ++asked.current;
      startTransition(async () => {
        const found = await searchRef.current(text);
        if (ask !== asked.current) return;
        if (typeof found === "string") {
          setProblem(found);
          setOptions([]);
        } else {
          setProblem(undefined);
          setOptions(found);
        }
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, open]);

  return (
    <div className="grid gap-2">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={id}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              e.preventDefault();
              if (options[0]) onPick(options[0]);
            }
          }}
          className="pl-9"
        />
        {pending && (
          <LoaderCircleIcon
            aria-hidden
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        )}
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="grid max-h-72 grid-cols-1 overflow-y-auto rounded-md border bg-card"
        >
          {problem ? (
            <li className="px-3 py-2.5 text-sm text-destructive">{problem}</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              {pending ? "Searching" : text.trim() ? "Nothing matches" : "Nothing to choose yet"}
            </li>
          ) : (
            options.map((option) => (
              <li key={option.id} role="option" aria-selected={false} className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    onPick(option);
                    setOpen(false);
                    setText("");
                  }}
                  className="w-full cursor-pointer border-b px-3 py-2.5 text-left transition-colors outline-none last:border-b-0 hover:bg-accent focus-visible:bg-accent"
                >
                  {renderOption(option)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The buyer of a quotation, order or payment on account: the chosen one with
 * "Change", or a search over open buyers (any buyer for a payment). Walk-in
 * customers is never offered: a sale without a buyer leaves this empty.
 */
export function BuyerPicker({
  id,
  value,
  onChange,
  purpose = "SALE",
  currency,
  invalid,
  describedBy,
  locked = false,
}: {
  id: string;
  value: { id: string; code: string; name: string } | null;
  onChange: (buyer: BuyerOption | null) => void;
  purpose?: "SALE" | "PAYMENT";
  currency: string;
  invalid?: boolean;
  describedBy?: string;
  /** Shown but not changeable (an order made from a proforma keeps its buyer). */
  locked?: boolean;
}) {
  if (value) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{value.name}</p>
          <p className="truncate text-[0.8125rem] text-muted-foreground">{value.code}</p>
        </div>
        {!locked && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            aria-label={`Change the buyer (${value.name})`}
          >
            <XIcon aria-hidden />
            Change
          </Button>
        )}
      </div>
    );
  }
  return (
    <SearchList<BuyerOption>
      id={id}
      label="Find a buyer"
      placeholder="Name, code or phone"
      invalid={invalid}
      describedBy={describedBy}
      search={async (text) => {
        const result = await findBuyersAction({ search: text, purpose });
        return result.ok ? result.data : result.error.message;
      }}
      onPick={onChange}
      renderOption={(b) => (
        <span className="grid gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <span className="min-w-0 truncate">{b.name}</span>
            {b.isVerified && <VerifiedBadge />}
            {b.grade && (
              <span className="text-[0.75rem] text-muted-foreground">
                Grade {GRADE_LABELS[b.grade]}
              </span>
            )}
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {[b.code, b.phone, b.city].filter(Boolean).join(" · ")}
            {b.balance !== null && /[1-9]/.test(b.balance) && (
              <span className={cn(b.balance.startsWith("-") ? "" : "text-destructive")}>
                {" · "}
                {b.balance.startsWith("-") ? "Credit " : "Owes "}
                {currency} {b.balance.replace("-", "")}
              </span>
            )}
          </span>
        </span>
      )}
    />
  );
}

/** A style to quote or sell: search by code or name, with its prices and the pieces ready. */
export function StylePicker({
  id,
  label = "Find a style",
  currency,
  onPick,
  exclude = [],
  autoFocus,
}: {
  id: string;
  label?: string;
  currency: string;
  onPick: (style: SaleStyle) => void;
  /** Styles already chosen, left out of the matches. */
  exclude?: string[];
  autoFocus?: boolean;
}) {
  return (
    <SearchList<SaleStyle>
      id={id}
      label={label}
      placeholder="Style code or name"
      autoFocus={autoFocus}
      search={async (text) => {
        const result = await findSaleStylesAction({ search: text });
        if (!result.ok) return result.error.message;
        return result.data.filter((s) => !exclude.includes(s.id));
      }}
      onPick={onPick}
      renderOption={(s) => (
        <span className="grid gap-0.5">
          <span className="truncate text-sm font-medium">
            {s.code} · {s.name}
          </span>
          <span className="truncate text-[0.8125rem] text-muted-foreground tabular-nums">
            Wholesale {s.wholesalePrice} · Retail {s.retailPrice} ·{" "}
            {formatCount(s.available, currency)} ready
          </span>
        </span>
      )}
    />
  );
}
