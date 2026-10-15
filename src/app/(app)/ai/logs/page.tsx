import type { Metadata } from "next";
import Link from "next/link";

import { AiLogList } from "@/components/ai/log-list";
import { AiNoAccess } from "@/components/ai/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { Panel } from "@/components/sales/detail-bits";
import { cn } from "@/lib/utils";
import { LOG_FILTERS } from "@/modules/ai/logs.service";
import { getAiLogsAction } from "@/server/actions/ai.actions";

export const metadata: Metadata = { title: "AI Logs" };

/**
 * Logs (ai.view or ai.manage): everything the AI did, marked AI with its
 * name, and every change to what it may do, newest first.
 */
export default async function AiLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { show } = await searchParams;
  const result = await getAiLogsAction(typeof show === "string" ? show : undefined);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AiNoAccess />;
    return <SectionError title="Logs" heading="The logs could not load" error={result.error} />;
  }
  const { filter, items, more } = result.data;

  return (
    <Panel title="Logs" id="ai-logs-heading">
      <nav aria-label="Show" className="mt-3 flex flex-wrap gap-2">
        {LOG_FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/ai/logs" : `/ai/logs?show=${f.value}`}
            aria-current={filter === f.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-[0.8125rem]",
              filter === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <AiLogList
        items={items}
        empty={
          filter === "ai"
            ? "The AI has not done anything yet."
            : "Nothing yet. Turning AI on, changing Control and answering its requests all show here."
        }
      />
      {more && (
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">The newest 100 are shown.</p>
      )}
    </Panel>
  );
}
