"use client";

import { ActivityIcon, ScanSearchIcon, WrenchIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { useWhen } from "@/components/ai/when";
import { FormAlert } from "@/components/forms/field";
import { type Tone, StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ServerHealthScreen as Health } from "@/modules/ai/health/health.service";
import {
  applyHealthFixAction,
  checkServerNowAction,
  setWeeklyHealthAction,
} from "@/server/actions/orders.actions";

/*
 * AI Center > Server Health (the platform owner only): check the server now
 * or every Saturday, read the report in Bengali, and press the safe fixes it
 * offers. Code is never changed from here.
 */

type Run = Health["runs"][number];

const WORST: Record<string, { text: string; tone: Tone }> = {
  OK: { text: "All is well", tone: "done" },
  WARN: { text: "Something to look at", tone: "open" },
  ERROR: { text: "A problem to fix today", tone: "warn" },
};

const LEVEL: Record<string, { text: string; dot: string }> = {
  OK: { text: "Fine", dot: "bg-success" },
  WARN: { text: "Look at it", dot: "bg-amber-400" },
  ERROR: { text: "A problem", dot: "bg-destructive" },
  SKIPPED: { text: "Not checked here", dot: "bg-muted-foreground/40" },
};

export function HealthScreen({ health: h }: { health: Health }) {
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const [latest, ...earlier] = h.runs;

  const checkNow = () =>
    startTransition(async () => {
      const result = await checkServerNowAction();
      setMessage(
        result.ok
          ? {
              tone: "success",
              text: `Checked: ${WORST[result.data.worst]?.text ?? result.data.worst}.`,
            }
          : { tone: "error", text: result.error.message },
      );
    });

  const weekly = (on: boolean) =>
    startTransition(async () => {
      const result = await setWeeklyHealthAction({ on });
      setMessage(
        result.ok
          ? {
              tone: "success",
              text: on ? "The weekly check is on." : "The weekly check is off.",
            }
          : { tone: "error", text: result.error.message },
      );
    });

  const fix = (runId: string, key: string) =>
    startTransition(async () => {
      const result = await applyHealthFixAction(runId, { key });
      setMessage(
        result.ok
          ? { tone: result.data.status === "DONE" ? "success" : "error", text: result.data.result }
          : { tone: "error", text: result.error.message },
      );
    });

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel
        title="Server Health"
        id="health-heading"
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={checkNow}>
              <ActivityIcon aria-hidden />
              Check now
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/ai/full-check">
                <ScanSearchIcon aria-hidden />
                Full check
              </Link>
            </Button>
          </div>
        }
      >
        <div className="mt-2 grid gap-3 text-sm">
          <p className="text-muted-foreground">
            Memory, disk space, database speed, backups, the HTTPS certificate, this week&apos;s
            errors and stuck jobs. The report is in Bengali; the safe fixes are one press each. Code
            is never changed from here: only through a pull request you merge.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={h.weekly ? "done" : "plain"}>
              {h.weekly ? "Weekly check on" : "Weekly check off"}
            </StatusBadge>
            <span className="text-muted-foreground">{h.weeklyText}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => weekly(!h.weekly)}
            >
              {h.weekly ? "Turn off the weekly check" : "Turn on the weekly check"}
            </Button>
          </div>
        </div>
      </Panel>

      {latest ? (
        <RunPanel run={latest} title="Last check" pending={pending} onFix={fix} />
      ) : (
        <p className="text-sm text-muted-foreground">No checks yet. Press Check now.</p>
      )}

      {earlier.length > 0 && (
        <Panel title="Earlier checks" id="health-earlier-heading">
          <ul className="mt-3 grid gap-2">
            {earlier.map((run) => (
              <li key={run.id}>
                <details className="rounded-md border p-3 text-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span>{when(run.startedAt)}</span>
                    <span className="text-muted-foreground">{run.by}</span>
                    <StatusBadge tone={WORST[run.worst]?.tone ?? "plain"}>
                      {WORST[run.worst]?.text ?? run.worst}
                    </StatusBadge>
                  </summary>
                  <div className="mt-3">
                    <Checks run={run} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function RunPanel({
  run,
  title,
  pending,
  onFix,
}: {
  run: Run;
  title: string;
  pending: boolean;
  onFix: (runId: string, key: string) => void;
}) {
  const when = useWhen({ year: true });
  const worst = WORST[run.worst];
  return (
    <Panel
      title={title}
      id="health-last-heading"
      action={worst && <StatusBadge tone={worst.tone}>{worst.text}</StatusBadge>}
    >
      <p className="mt-1 text-[0.8125rem] text-muted-foreground">
        {`${when(run.startedAt)}, ${run.by}.`}
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Checks run={run} />
        <div className="grid content-start gap-3">
          <div>
            <p className="text-sm font-medium">Report</p>
            <p className="text-[0.8125rem] text-muted-foreground">
              {run.reportByAi
                ? `Written by Mehedi 2.0 (AI)${run.aiCost ? `, cost ${run.aiCost}` : ""}.`
                : "Written by the ERP from the checks."}
            </p>
          </div>
          <div
            lang="bn"
            className="rounded-md border bg-background p-4 text-sm break-words whitespace-pre-wrap"
          >
            {run.report}
          </div>
          {run.fixes.length > 0 && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">Safe fixes</p>
              {run.fixes.map((f) => (
                <div key={f.key} className="grid gap-1 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={f.status === "DONE" ? "outline" : "default"}
                      disabled={pending || f.status === "DONE"}
                      onClick={() => onFix(run.id, f.key)}
                    >
                      <WrenchIcon aria-hidden />
                      {f.label}
                    </Button>
                    {f.status === "DONE" && <StatusBadge tone="done">Done</StatusBadge>}
                    {f.status === "FAILED" && <StatusBadge tone="warn">Did not work</StatusBadge>}
                  </div>
                  {f.result && <p className="text-[0.8125rem] text-muted-foreground">{f.result}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Checks({ run }: { run: Run }) {
  return (
    <ul className="grid content-start gap-2">
      {run.checks.map((c) => {
        const l = LEVEL[c.level] ?? LEVEL.SKIPPED!;
        return (
          <li
            key={c.key}
            className={cn(
              "flex items-start gap-3 rounded-md border bg-background p-3 text-sm",
              c.level === "ERROR" && "border-destructive/30",
              c.level === "WARN" && "border-amber-400/40",
            )}
          >
            <span
              role="img"
              aria-label={l.text}
              title={l.text}
              className={cn("mt-1 size-3 shrink-0 rounded-full", l.dot)}
            />
            <div className="min-w-0">
              <p className="font-medium">{c.label}</p>
              <p className="mt-0.5 break-words text-muted-foreground">{c.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
