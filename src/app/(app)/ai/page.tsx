import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AiSwitch } from "@/components/ai/ai-switch";
import { AiLogList } from "@/components/ai/log-list";
import { AiMonthCostCard } from "@/components/ai/month-cost";
import { MorningBrief } from "@/components/ai/morning-brief";
import { AiNoAccess } from "@/components/ai/no-access";
import { AiRequestsList } from "@/components/ai/requests-list";
import { SectionError } from "@/components/dashboard/section-error";
import { Panel } from "@/components/sales/detail-bits";
import {
  getAiLogsAction,
  getAiMonthCostAction,
  getAiStatusAction,
  getRequestsAction,
} from "@/server/actions/ai.actions";
import { getMorningBriefAction } from "@/server/actions/orders.actions";

export const metadata: Metadata = { title: "AI Center" };

/**
 * AI Home (ai.view or ai.manage): the main switch (off until the owner turns
 * it on), the morning brief, today's and this month's cost (the month against
 * the budget), what the AI waits for (permission and Deletion requests) and
 * what it did last.
 */
export default async function AiHomePage() {
  const [status, brief, month, requests, logs] = await Promise.all([
    getAiStatusAction(),
    getMorningBriefAction(),
    getAiMonthCostAction(),
    getRequestsAction(),
    getAiLogsAction("ai"),
  ]);
  if (!status.ok) {
    if (status.error.code === "FORBIDDEN") return <AiNoAccess />;
    return (
      <SectionError title="AI Home" heading="The AI Center could not load" error={status.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <AiSwitch status={status.data} />
      {brief.ok ? (
        <MorningBrief brief={brief.data} />
      ) : (
        <SectionError
          title="Morning brief"
          heading="The morning brief could not load"
          error={brief.error}
        />
      )}
      {month.ok ? (
        <AiMonthCostCard month={month.data} />
      ) : (
        <SectionError title="AI cost" heading="The AI cost could not load" error={month.error} />
      )}
      {requests.ok ? (
        <AiRequestsList requests={requests.data} pinSet={status.data.pinSet} />
      ) : (
        <SectionError
          title="Waiting for your answer"
          heading="The AI's requests could not load"
          error={requests.error}
        />
      )}
      {logs.ok ? (
        <Panel
          title="What the AI did last"
          id="ai-last-heading"
          action={
            <Link
              href="/ai/logs"
              className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
            >
              All logs
              <ArrowRightIcon aria-hidden className="size-3.5" />
            </Link>
          }
        >
          <AiLogList
            items={logs.data.items.slice(0, 8)}
            empty="The AI has not done anything yet. Its work shows here, marked AI, with its name."
          />
        </Panel>
      ) : (
        <SectionError
          title="What the AI did last"
          heading="The AI's work could not load"
          error={logs.error}
        />
      )}
    </div>
  );
}
