"use client";

import { Loader2Icon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SearchGroup, SearchResult } from "@/modules/search/search.service";

/*
 * The search box on every page (Release 2). The top bar (and the modern side
 * menu) hold a Search button; it, "/" or Ctrl+K (⌘K on a Mac) opens one search
 * window, full width on phones. Typing searches the records this person may
 * open (GET /api/search) and lists them by kind; a click, or the arrow keys
 * and Enter, opens one.
 */

/** Asks the one search window on the page to open (several buttons may ask). */
const OPEN_EVENT = "extras:open-search";
/** The fewest letters searched for (search.service.ts MIN_QUERY). */
const MIN_QUERY = 2;
/** How long typing pauses before the search runs. */
const PAUSE_MS = 200;

export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Whether a key press is someone typing into a field (then "/" is just a slash). */
function typingIn(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

type State =
  | { kind: "idle" }
  /** Searching; the last results stay shown meanwhile. */
  | { kind: "loading"; result?: SearchResult }
  | { kind: "done"; result: SearchResult }
  | { kind: "error"; message: string };

/**
 * The search window itself, once per page (app/(app)/layout.tsx), with the
 * keyboard shortcuts.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      } else if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !typingIn(event.target)
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const words = query.trim();
  useEffect(() => {
    if (!open || words.length < MIN_QUERY) return;
    const stop = new AbortController();
    const timer = window.setTimeout(async () => {
      setState((was) => ({
        kind: "loading",
        result: was.kind === "done" || was.kind === "loading" ? was.result : undefined,
      }));
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(words)}`, {
          signal: stop.signal,
          headers: { accept: "application/json" },
        });
        const body = (await response.json()) as
          { ok: true; data: SearchResult } | { ok: false; error: { message: string } };
        if (stop.signal.aborted) return;
        setActive(0);
        setState(
          body.ok
            ? { kind: "done", result: body.data }
            : { kind: "error", message: body.error.message },
        );
      } catch {
        if (!stop.signal.aborted) {
          setState({ kind: "error", message: "The search could not run. Try again." });
        }
      }
    }, PAUSE_MS);
    return () => {
      stop.abort();
      window.clearTimeout(timer);
    };
  }, [open, words]);

  const shown = state.kind === "done" || state.kind === "loading" ? state.result : undefined;
  const groups = useMemo<SearchGroup[]>(
    () => (shown && words.length >= MIN_QUERY ? shown.groups : []),
    [shown, words],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setState({ kind: "idle" });
      setActive(0);
    }
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = flat[Math.min(active, flat.length - 1)];
      if (hit) {
        close(false);
        router.push(hit.href);
      }
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;
  let index = -1;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        className="top-0 left-0 flex max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-3 rounded-none border-x-0 border-t-0 p-4 sm:top-[12vh] sm:left-1/2 sm:max-h-[76vh] sm:w-[calc(100%-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:rounded-lg sm:border sm:p-5"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3 focus-within:ring-[3px] focus-within:ring-ring/25">
            {state.kind === "loading" ? (
              <Loader2Icon
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : (
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <input
              ref={input}
              type="search"
              role="combobox"
              aria-label="Search"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-activedescendant={flat.length > 0 ? optionId(active) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKey}
              placeholder="Order, buyer, style, invoice, employee…"
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
          </div>
          <DialogClose className="shrink-0 rounded-md px-2 py-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25">
            Close
          </DialogClose>
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="min-h-0 overflow-y-auto"
        >
          {words.length < MIN_QUERY ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              Type at least 2 letters of a number, code, name or phone.
            </p>
          ) : state.kind === "error" ? (
            <p role="alert" className="px-1 py-2 text-sm text-destructive">
              {state.message}
            </p>
          ) : state.kind === "done" && groups.length === 0 ? (
            <p className="px-1 py-2 text-sm break-words text-muted-foreground">
              Nothing found for {words}.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.kind} aria-label={group.label} className="py-1">
                <h3 className="eyebrow px-1 pt-2 pb-1">{group.label}</h3>
                <ul className="grid">
                  {group.hits.map((hit) => {
                    index += 1;
                    const mine = index;
                    const selected = mine === active;
                    return (
                      <li key={hit.id}>
                        <Link
                          id={optionId(mine)}
                          role="option"
                          aria-selected={selected}
                          href={hit.href}
                          onClick={() => close(false)}
                          onMouseMove={() => setActive(mine)}
                          className={cn(
                            "block min-w-0 rounded-md px-2 py-2 outline-none",
                            selected && "bg-muted",
                          )}
                        >
                          <span className="block text-sm font-medium break-words">{hit.title}</span>
                          {hit.detail && (
                            <span className="block text-[0.8125rem] break-words text-muted-foreground">
                              {hit.detail}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The button that opens the search: an icon in the top bar (with the word and
 * its shortcut on large screens), or a menu line in the modern side menu.
 */
export function SearchButton({
  variant,
  labelClassName,
  className,
}: {
  variant: "bar" | "sidebar";
  /** The side menu hides the word while it is narrowed to icons. */
  labelClassName?: string;
  className?: string;
}) {
  if (variant === "sidebar") {
    return (
      <span className={cn("relative block", className)}>
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label="Search"
          aria-keyshortcuts="Control+K /"
          className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-md bg-primary-foreground/8 px-3 text-sm text-primary-foreground/80 transition-colors outline-none hover:bg-primary-foreground/12 hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30"
        >
          <SearchIcon className="size-[1.125rem] shrink-0" aria-hidden />
          <span className={cn("flex-1 truncate pr-12 text-left", labelClassName)}>Search</span>
        </button>
        <Shortcut className={labelClassName} />
      </span>
    );
  }
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        onClick={openGlobalSearch}
        aria-label="Search"
        aria-keyshortcuts="Control+K /"
        title="Search (Ctrl+K or /)"
        className="inline-flex size-9 cursor-pointer items-center justify-center gap-2 rounded-md text-primary-foreground/85 transition-colors outline-none hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-primary-foreground/30 2xl:w-52 2xl:justify-start 2xl:bg-primary-foreground/10 2xl:px-3"
      >
        <SearchIcon className="size-[1.125rem] shrink-0" aria-hidden />
        <span className="hidden flex-1 text-left text-sm 2xl:inline">Search</span>
      </button>
      <Shortcut className="hidden 2xl:inline" />
    </span>
  );
}

/** The shortcut drawn inside the button's box, beside the word (not part of its name). */
function Shortcut({ className }: { className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-primary-foreground/25 px-1.5 font-sans text-xs text-primary-foreground/70",
        className,
      )}
    >
      Ctrl K
    </kbd>
  );
}
