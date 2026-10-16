"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { INSIGHTS_TAB_EVENT } from "./open-insights-tab";

export type InsightsTab = {
  value: string;
  label: string;
  /** A count next to the label; red when it is a warning. */
  count?: number;
  alert?: boolean;
  content: React.ReactNode;
};

/**
 * The Insights widget's tabs, with an optional warning line that opens its tab.
 * Elsewhere on the page, OpenInsightsTab opens a tab and brings it into view.
 */
export function InsightsTabs({
  tabs,
  notice,
}: {
  tabs: InsightsTab[];
  notice?: { message: string; action: string; tab: string };
}) {
  const [tab, setTab] = useState(tabs[0]?.value ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const values = tabs.map((t) => t.value).join(" ");

  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value !== "string" || !values.split(" ").includes(value)) return;
      setTab(value);
      ref.current?.scrollIntoView({ block: "start" });
    };
    window.addEventListener(INSIGHTS_TAB_EVENT, open);
    return () => window.removeEventListener(INSIGHTS_TAB_EVENT, open);
  }, [values]);

  return (
    // Clear of the bar pinned at the top when scrolled to.
    <div
      ref={ref}
      className="mt-5 grid scroll-mt-[calc(var(--app-top,0px)+6rem)] grid-cols-1 gap-5"
    >
      {notice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-destructive/25 bg-destructive/[0.04] px-4 py-3 text-sm"
        >
          <p className="flex items-start gap-2.5 text-destructive">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {notice.message}
          </p>
          {tab !== notice.tab && (
            <button
              type="button"
              onClick={() => setTab(notice.tab)}
              className="cursor-pointer text-[0.8125rem] font-medium text-destructive underline-offset-4 hover:underline"
            >
              {notice.action}
            </button>
          )}
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        {/* Four tabs do not fit across a phone, so there they are a two-by-two set
            of buttons (every count stays in sight); underlined tabs from tablets up. */}
        <TabsList
          aria-label="Insights"
          className="grid grid-cols-2 gap-2 overflow-visible border-b-0 sm:flex sm:gap-6 sm:overflow-x-auto sm:border-b"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="mb-0 justify-center rounded-md border border-border bg-card px-3 py-2.5 focus-visible:ring-[3px] focus-visible:ring-ring/25 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:-mb-px sm:justify-start sm:rounded-none sm:border-0 sm:border-b-2 sm:border-transparent sm:bg-transparent sm:px-0 sm:pt-1 sm:pb-3 sm:focus-visible:ring-0 sm:data-[state=active]:border-primary sm:data-[state=active]:bg-transparent sm:data-[state=active]:text-primary"
            >
              {t.label}
              {t.count ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-xs leading-4 font-medium tabular-nums",
                    t.alert
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {t.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
