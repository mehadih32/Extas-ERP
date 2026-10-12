"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ProfileTab = { value: string; label: string };

/**
 * The tabs of an employee's 360° profile. Every tab is in the page from the
 * start (switching is instant, nothing reloads, and a dialog open in one tab
 * keeps its place); the open tab goes in the address (?tab=pay), so a refresh
 * or a shared link opens the same one.
 */
export function ProfileTabs({
  tabs,
  initial,
  children,
}: {
  tabs: ProfileTab[];
  initial: string;
  children: React.ReactNode;
}) {
  const [tab, setTab] = useState(tabs.some((t) => t.value === initial) ? initial : tabs[0]!.value);
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        setTab(next);
        const url = new URL(window.location.href);
        if (next === tabs[0]!.value) url.searchParams.delete("tab");
        else url.searchParams.set("tab", next);
        window.history.replaceState(null, "", url);
      }}
      className="gap-6"
    >
      <TabsList aria-label="Profile">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}

/** One tab's content; kept in the page while another tab is open. */
export function ProfileTab({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsContent
      value={value}
      forceMount
      className="grid grid-cols-1 content-start gap-6 data-[state=inactive]:hidden"
    >
      {children}
    </TabsContent>
  );
}
