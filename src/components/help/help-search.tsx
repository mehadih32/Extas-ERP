"use client";

import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  LockIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { missingFeaturePrompt, quotedSearch } from "@/modules/help/prompt";
import { type HelpSearchEntry, searchHelp, searchWords } from "@/modules/help/search";

import { bnDigits, helpHref, NOT_IN_ROLE } from "./labels";

/** Copies text, saying so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers or no permission: select the text so it can be copied by hand.
      const area = document.getElementById("missing-feature-prompt");
      if (area instanceof HTMLTextAreaElement) area.select();
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button type="button" variant="outline" onClick={copy} className="h-11 sm:h-9">
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** The Bengali notice and the English prompt for a feature the manual does not have. */
function MissingFeature({
  query,
  roleName,
  companyName,
  today,
  found,
}: {
  query: string;
  roleName: string;
  companyName: string;
  today: string;
  /** Some guides matched; the person asked for the prompt anyway. */
  found: boolean;
}) {
  const prompt = missingFeaturePrompt({ query, roleName, companyName, day: today });
  return (
    <section
      aria-labelledby="missing-heading"
      className="grid gap-4 rounded-lg border border-dashed border-primary/30 bg-card p-4 sm:p-5"
    >
      <div lang="bn" className="grid gap-2">
        <h2 id="missing-heading" className="flex items-center gap-2 font-medium text-primary">
          <SparklesIcon className="size-4 shrink-0" aria-hidden />
          {found ? "যা খুঁজছেন তা এখানে নেই?" : "দুঃখিত, এই বিষয়ে কোনো নির্দেশিকা পাওয়া যায়নি"}
        </h2>
        <p className="text-[0.9375rem] leading-[1.8] text-foreground/90">
          {found ? (
            <>
              “{quotedSearch(query)}” যদি অ্যাপে এখনো না থাকে, নিচের লেখাটি আপনার অ্যাডমিনকে দিন।
              অ্যাডমিন এটি Claude-কে দিলে সুবিধাটি তৈরি করা যাবে।
            </>
          ) : (
            <>
              “{quotedSearch(query)}” সম্ভবত এখনো Extas ERP-এ যোগ করা হয়নি। অসুবিধার জন্য আমরা
              আন্তরিকভাবে দুঃখিত। নিচের ইংরেজি লেখাটি কপি করে আপনার অ্যাডমিনকে দিন। অ্যাডমিন এটি
              Claude-কে দিলে সুবিধাটি তৈরি করা যাবে।
            </>
          )}
        </p>
      </div>
      <label htmlFor="missing-feature-prompt" className="sr-only">
        Prompt for the admin to give to Claude
      </label>
      <textarea
        id="missing-feature-prompt"
        readOnly
        value={prompt}
        rows={12}
        spellCheck={false}
        className="w-full resize-y rounded-md border bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <CopyButton text={prompt} label="Copy the prompt" />
        <p lang="bn" className="text-sm text-muted-foreground">
          শব্দ বদলে আবার খুঁজে দেখতে পারেন, যেমন ইংরেজি নামে।
        </p>
      </div>
    </section>
  );
}

/**
 * The Help Center's search box: results appear as people type, in Bengali or
 * English. When nothing matches, it says so politely in Bengali and writes the
 * prompt the admin can give to Claude to build the missing feature.
 */
export function HelpSearch({
  entries,
  initialQuery,
  roleName,
  companyName,
  today,
  children,
}: {
  entries: HelpSearchEntry[];
  initialQuery: string;
  roleName: string;
  companyName: string;
  /** The company's today, for the prompt. */
  today: string;
  /** What the page shows while nothing is typed (the manual's sections). */
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const deferred = useDeferredValue(query);
  const results = useMemo(() => searchHelp(entries, deferred), [entries, deferred]);
  const [askAnyway, setAskAnyway] = useState(false);
  const searching = searchWords(deferred).length > 0;

  // Keep ?q= in the address so a search survives going back from a guide.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (deferred.trim()) url.searchParams.set("q", deferred.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [deferred]);

  return (
    <div className="grid gap-6">
      <div role="search" className="grid gap-2">
        <label htmlFor="help-search" lang="bn" className="text-sm font-medium">
          কী জানতে চান? বাংলা বা ইংরেজিতে লিখুন
        </label>
        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="help-search"
            type="search"
            value={query}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value);
              setAskAnyway(false);
            }}
            placeholder="যেমন: ইনভয়েস, কোটেশন, বেতন, stock count"
            className="h-12 w-full rounded-lg border border-input bg-card pr-11 pl-11 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {!searching ? (
        children
      ) : (
        <div className="grid gap-4">
          <p role="status" lang="bn" className="text-sm text-muted-foreground">
            {results.length > 0
              ? `${bnDigits(results.length)}টি নির্দেশিকা পাওয়া গেছে`
              : "কোনো নির্দেশিকা পাওয়া যায়নি"}
          </p>
          {results.length > 0 && (
            <ul className="grid grid-cols-1 gap-2" aria-label="Search results">
              {results.map((result) => (
                <li key={`${result.sectionId}/${result.slug}`}>
                  <Link
                    href={helpHref.article(result.sectionId, result.slug)}
                    className="group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
                  >
                    <span lang="bn" className="grid min-w-0 flex-1 gap-1">
                      <span className="text-xs text-muted-foreground">{result.sectionTitle}</span>
                      <span className="font-medium text-primary">{result.title}</span>
                      <span className="text-sm leading-relaxed text-muted-foreground">
                        {result.summary}
                      </span>
                      {!result.open && (
                        <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <LockIcon className="size-3.5" aria-hidden />
                          {NOT_IN_ROLE}
                        </span>
                      )}
                    </span>
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {results.length === 0 || askAnyway ? (
            <MissingFeature
              query={deferred}
              roleName={roleName}
              companyName={companyName}
              today={today}
              found={results.length > 0}
            />
          ) : (
            <button
              type="button"
              lang="bn"
              onClick={() => setAskAnyway(true)}
              className={cn(
                "justify-self-start text-sm text-primary underline-offset-4 hover:underline",
                "cursor-pointer",
              )}
            >
              যা খুঁজছেন তা পাননি? নতুন সুবিধার অনুরোধ লিখুন
            </button>
          )}
        </div>
      )}
    </div>
  );
}
