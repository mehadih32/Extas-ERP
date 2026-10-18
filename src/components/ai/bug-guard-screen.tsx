"use client";

import {
  BellOffIcon,
  EyeIcon,
  EyeOffIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Undo2Icon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { usePinPrompt } from "@/components/ai/pin-prompt";
import { useWhen } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import {
  type ScheduleDraft,
  ScheduleFields,
  scheduleInput,
  WEEKDAY_NAMES,
} from "@/components/forms/schedule-fields";
import { type Tone, StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { BugGuardScreen as Screen } from "@/modules/bug-guard/screen.service";
import { AREA_LABELS, SEVERITY_LABELS, type Severity } from "@/modules/bug-guard/types";
import {
  applyCorrectionAction,
  cancelCorrectionAction,
  fixFindingAction,
  ignoreFindingAction,
  liftBlockAction,
  reopenFindingAction,
  runBugGuardNowAction,
  saveBugGuardSettingsAction,
  snoozeFindingAction,
  undoCorrectionAction,
} from "@/server/actions/bug-guard.actions";

/*
 * AI Center > Bug Guard (the platform owner only): the all-round auditor. The
 * status, "Run now", the problems grouped Urgent / Important / Can wait with
 * Fix, Ignore and Remind me later, the fixes on their way, the corrections
 * (Apply and Undo with the PIN), blocked sign-in places, the schedule, what it
 * checks, and its own log. The problems are written in simple Bengali.
 */

type Finding = Screen["open"][number];
type Message = { tone: "success" | "error" | "note"; text: string };

const SEVERITY_TONE: Record<Severity, Tone> = { URGENT: "warn", IMPORTANT: "open", LATER: "plain" };

const FIX_HINT: Record<string, string> = {
  CODE: "Fix sends it to Claude Code, who makes a pull request with a test. You merge it with your PIN.",
  DATA: "Fix prepares the exact correction, a new record. Apply (with your PIN) backs up first; Undo adds the opposite record.",
  SECURITY: "Fix takes this safe step with your PIN.",
  MANUAL: "Only you can do this: Fix shows the steps.",
  NONE: "A note: nothing to fix.",
};

const CORRECTION_STATUS: Record<string, { text: string; tone: Tone }> = {
  PREPARED: { text: "Waiting for you", tone: "open" },
  BACKING_UP: { text: "Backing up first", tone: "open" },
  APPLIED: { text: "Applied", tone: "done" },
  UNDONE: { text: "Undone", tone: "closed" },
  FAILED: { text: "Not applied", tone: "warn" },
  STALE: { text: "Out of date", tone: "closed" },
  CANCELLED: { text: "Cancelled", tone: "closed" },
};

const REQUEST_STATE: Record<string, string> = {
  SENT: "Claude Code is working on it",
  PR_OPEN: "Pull request open",
  MERGED: "Merged: Bug Guard checks again after the safe update",
  STOPPED: "Claude Code stopped",
};

const RUN_TRIGGER: Record<string, string> = {
  SCHEDULE: "on schedule",
  NOW: "Run now",
  TELEGRAM: "from Telegram",
  AFTER_FIX: "after a fix",
  AFTER_DEPLOY: "after an update",
};

function ago(at: Date | string | null | undefined, now: number) {
  if (!at) return "";
  const minutes = Math.max(0, Math.round((now - new Date(at).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function BugGuardScreen({ guard: g }: { guard: Screen }) {
  const when = useWhen({ year: true });
  const [now] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>();
  const { withPin, dialog } = usePinPrompt();

  const run = <T,>(work: () => Promise<ActionResult<T>>, done: (data: T) => string) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok
          ? { tone: "success", text: done(result.data) }
          : { tone: "error", text: result.error.message },
      );
    });

  const fix = (f: Finding) =>
    startTransition(async () => {
      const result = await withPin((pin) => fixFindingAction(f.id, { pin }));
      if (!result.ok) return setMessage({ tone: "error", text: result.error.message });
      const d = result.data;
      setMessage(
        d.kind === "CODE"
          ? {
              tone: "success",
              text: `Sent to Claude Code (issue #${d.issueNumber}). You will hear when the fix is ready to merge.`,
            }
          : d.kind === "DATA"
            ? {
                tone: "success",
                text: "The correction is ready: check it under Corrections, then Apply.",
              }
            : d.kind === "SECURITY"
              ? { tone: "success", text: d.done }
              : { tone: "note", text: d.steps },
      );
    });

  const counts = g.last
    ? `${g.last.urgent} urgent, ${g.last.important} important, ${g.last.later} can wait`
    : "";

  return (
    <div className="grid gap-6">
      {dialog}
      {message && (
        <FormAlert tone={message.tone}>
          <span lang={message.tone === "note" ? "bn" : undefined} className="whitespace-pre-wrap">
            {message.text}
          </span>
        </FormAlert>
      )}

      <Panel
        title="Bug Guard"
        id="guard-heading"
        action={
          <Button
            type="button"
            size="sm"
            disabled={pending || Boolean(g.running)}
            onClick={() =>
              run(
                runBugGuardNowAction,
                () => "Bug Guard is checking. The report comes to your inbox and Telegram.",
              )
            }
          >
            <PlayIcon aria-hidden />
            Run now
          </Button>
        }
      >
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-base font-medium" role="status">
            {g.running
              ? `Checking now (started ${ago(g.running.startedAt, now)}).`
              : g.last
                ? g.last.urgent + g.last.important === 0
                  ? `Last check ${ago(g.last.finishedAt ?? g.last.startedAt, now)}: all is well.`
                  : `Last check ${ago(g.last.finishedAt ?? g.last.startedAt, now)}: ${counts}.`
                : "Bug Guard has not checked yet. Press Run now."}
          </p>
          <p className="text-muted-foreground">
            {`Next check: ${g.settings.nextRunAt ? when(g.settings.nextRunAt) : "none planned"} (${g.settings.scheduleText}). Weekly summary on ${WEEKDAY_NAMES[g.settings.weeklyDay]} at ${g.settings.weeklyTime}.`}
          </p>
          {g.last?.note && <p className="text-muted-foreground">{g.last.note}</p>}
          {g.last?.fullCheckWaiting && (
            <p className="text-muted-foreground">
              The Full check (every screen, PDF and the layout at four widths) is running on GitHub;
              its findings are added when it reports back.
            </p>
          )}
          <p className="text-muted-foreground">
            It checks the screens, the data and accounts, security, how the ERP is used and the AI,
            then explains each problem in simple Bengali with a fix. Anything that changes data,
            money, code or permissions waits for your PIN. It never deletes data, changes roles or
            permissions, merges or deploys by itself, sends anything to buyers or suppliers, moves
            money, or turns off backups or its own checks.
          </p>
          {!g.pinSet && (
            <FormAlert tone="note">
              Set your PIN in{" "}
              <Link href="/ai/settings" className="underline">
                AI Center &gt; Settings
              </Link>{" "}
              first: Apply, Undo and the security steps ask for it.
            </FormAlert>
          )}
        </div>
      </Panel>

      <Panel title="Problems" id="guard-open-heading">
        {g.open.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No open problems.</p>
        ) : (
          <div className="mt-3 grid gap-6">
            {(["URGENT", "IMPORTANT", "LATER"] as const).map((sev) => {
              const list = g.open.filter((f) => f.severity === sev);
              if (list.length === 0) return null;
              return (
                <section key={sev} aria-labelledby={`guard-${sev}`} className="grid gap-3">
                  <h4 id={`guard-${sev}`} className="font-medium">
                    {`${SEVERITY_LABELS[sev]} (${list.length})`}
                  </h4>
                  {list.map((f) => (
                    <FindingCard key={f.id} f={f} now={now}>
                      <div className="flex flex-wrap gap-2">
                        {f.fixKind !== "NONE" && (
                          <Button type="button" size="sm" disabled={pending} onClick={() => fix(f)}>
                            <WrenchIcon aria-hidden />
                            Fix
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => ignoreFindingAction(f.id),
                              () => "Ignored: it is not reported again unless it gets worse.",
                            )
                          }
                        >
                          <EyeOffIcon aria-hidden />
                          Ignore
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => snoozeFindingAction(f.id),
                              () => "It will be reported again in 3 days if it is still there.",
                            )
                          }
                        >
                          <BellOffIcon aria-hidden />
                          Remind me later
                        </Button>
                      </div>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {FIX_HINT[f.fixKind]}
                      </p>
                    </FindingCard>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </Panel>

      {g.fixing.length > 0 && (
        <Panel title="With Claude Code" id="guard-fixing-heading">
          <ul className="mt-3 grid gap-3">
            {g.fixing.map((f) => (
              <li key={f.id}>
                <FindingCard f={f} now={now}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge tone="open">
                      {f.request ? (REQUEST_STATE[f.request.state] ?? f.request.state) : "Sent"}
                    </StatusBadge>
                    {f.request?.issueUrl && (
                      <a
                        href={f.request.issueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {`Issue #${f.request.issueNumber}`}
                      </a>
                    )}
                    {f.request?.prUrl && (
                      <a
                        href={f.request.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {`Pull request #${f.request.prNumber}`}
                      </a>
                    )}
                    {f.request?.state === "PR_OPEN" && (
                      <Button asChild size="sm">
                        <Link href="/ai/full-check">Review and merge</Link>
                      </Button>
                    )}
                  </div>
                </FindingCard>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Corrections
        g={g}
        pending={pending}
        withPin={withPin}
        run={run}
        startTransition={startTransition}
        setMessage={setMessage}
      />

      {g.blocks.length > 0 && (
        <Panel title="Blocked sign-in places" id="guard-blocks-heading">
          <ul className="mt-3 grid gap-2">
            {g.blocks.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium break-all">{b.source}</p>
                  <p className="text-muted-foreground">
                    {`${b.reason}. Blocked ${when(b.blockedAt)} until ${when(b.blockedUntil)}.`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await withPin((pin) => liftBlockAction(b.id, { pin }));
                      setMessage(
                        result.ok
                          ? { tone: "success", text: "Sign-in from that place is allowed again." }
                          : { tone: "error", text: result.error.message },
                      );
                    })
                  }
                >
                  <ShieldCheckIcon aria-hidden />
                  Allow again
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {g.waiting.length > 0 && (
        <Panel title="Ignored and waiting" id="guard-waiting-heading">
          <ul className="mt-3 grid gap-2">
            {g.waiting.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p lang="bn" className="break-words">
                    {f.title}
                  </p>
                  <p className="text-muted-foreground">
                    {f.status === "IGNORED" ? "Ignored" : `Waiting until ${when(f.snoozedUntil)}`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => reopenFindingAction(f.id),
                      () => "It is back in the list.",
                    )
                  }
                >
                  <EyeIcon aria-hidden />
                  Show again
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {g.done.length > 0 && (
        <Panel title="Put right lately" id="guard-done-heading">
          <ul className="mt-3 grid gap-2 text-sm">
            {g.done.map((f) => (
              <li key={f.id} className="rounded-md border p-3">
                <p lang="bn" className="break-words">
                  {f.title}
                </p>
                <p className="text-muted-foreground">
                  {`${f.status === "FIXED" ? "Fixed" : "Not found any more"} ${when(f.goneAt)}`}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <SchedulePanel g={g} setMessage={setMessage} />

      <Panel title="What Bug Guard checks" id="guard-checks-heading">
        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          {g.checks.map((area) => (
            <div key={area.area} className="grid content-start gap-1">
              <p className="font-medium">{AREA_LABELS[area.area]}</p>
              <ul className="grid gap-1">
                {area.list.map((c) => {
                  const last = g.last?.checks.find((r) => r.key === c.key);
                  return (
                    <li key={c.key} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          !last && "bg-muted-foreground/40",
                          last?.status === "OK" && "bg-success",
                          last?.status === "FOUND" && "bg-amber-400",
                          last?.status === "FAILED" && "bg-destructive",
                        )}
                      />
                      <span className="min-w-0">
                        {c.label}
                        {last?.status === "FOUND" && ` (${last.found} found)`}
                        {last?.status === "FAILED" &&
                          ` (could not finish: ${last.note ?? "it stopped"})`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Bug Guard's log" id="guard-log-heading">
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">{`Runs (${g.runs.length})`}</summary>
          <ul className="mt-2 grid gap-1">
            {g.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="text-foreground">{when(r.startedAt)}</span>
                <span>{`${RUN_TRIGGER[r.trigger] ?? r.trigger}, ${r.by}:`}</span>
                <span>
                  {r.status === "DONE"
                    ? `${r.urgent} urgent, ${r.important} important, ${r.later} can wait; ${r.newCount} new, ${r.fixedCount} put right`
                    : r.status === "RUNNING"
                      ? "checking"
                      : `stopped: ${r.note ?? ""}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">{`Everything it did (${g.events.length})`}</summary>
          <ul className="mt-2 grid gap-1">
            {g.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="text-foreground">{when(e.at)}</span>
                <span>{`${e.by}:`}</span>
                <span lang="bn" className="min-w-0 break-words">
                  {e.summary}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </Panel>
    </div>
  );
}

function FindingCard({
  f,
  now,
  children,
}: {
  f: Finding;
  now: number;
  children?: React.ReactNode;
}) {
  const when = useWhen({ year: true });
  return (
    <article
      className={cn(
        "grid gap-3 rounded-md border bg-background p-4 text-sm",
        f.severity === "URGENT" && f.status === "OPEN" && "border-destructive/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</StatusBadge>
        <span className="text-muted-foreground">{AREA_LABELS[f.area]}</span>
        <span className="text-muted-foreground">
          {f.seenCount > 1
            ? `· seen ${f.seenCount} times since ${when(f.firstSeenAt)}`
            : `· found ${ago(f.firstSeenAt, now)}`}
        </span>
      </div>
      <p lang="bn" className="text-base font-medium break-words">
        {f.title}
      </p>
      <dl className="grid gap-2">
        {(f.place || f.href) && (
          <div>
            <dt className="text-muted-foreground">Where</dt>
            <dd className="break-words">
              {f.href ? (
                <Link href={f.href} className="underline">
                  {f.place ?? f.href}
                </Link>
              ) : (
                f.place
              )}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">Why it matters</dt>
          <dd lang="bn" className="break-words">
            {f.why}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Proposed fix</dt>
          <dd lang="bn" className="break-words">
            {f.fix}
          </dd>
        </div>
      </dl>
      {f.evidence.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Evidence</summary>
          <dl className="mt-2 grid gap-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-x-4">
            {f.evidence.map((e, i) => (
              <div key={i} className="contents">
                <dt lang="bn" className="break-words text-muted-foreground">
                  {e.label}
                </dt>
                <dd lang="bn" className="break-words">
                  {e.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {f.correctionText && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-muted-foreground">The exact correction (before → after)</p>
          <p lang="bn" className="mt-1 break-words whitespace-pre-wrap">
            {f.correctionText}
          </p>
        </div>
      )}
      {children}
    </article>
  );
}

function Corrections({
  g,
  pending,
  withPin,
  run,
  startTransition,
  setMessage,
}: {
  g: Screen;
  pending: boolean;
  withPin: ReturnType<typeof usePinPrompt>["withPin"];
  run: <T>(work: () => Promise<ActionResult<T>>, done: (data: T) => string) => void;
  startTransition: (work: () => Promise<void>) => void;
  setMessage: (m: Message) => void;
}) {
  const when = useWhen({ year: true });
  if (g.corrections.length === 0) return null;
  const pinned = (work: (pin?: string) => Promise<ActionResult<unknown>>, done: string) =>
    startTransition(async () => {
      const result = await withPin(work);
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
    });
  return (
    <Panel title="Corrections" id="guard-corrections-heading">
      <p className="mt-2 text-sm text-muted-foreground">
        A correction never changes a stored figure: it adds a new record, only while things still
        read as shown. For stock it adds a movement of the difference (the stock and its value stay
        the same); in the accounts it posts an adjusting entry. Apply asks for your PIN and makes a
        full backup first. History is never edited or deleted. Undo (with your PIN) adds the
        opposite record.
      </p>
      <ul className="mt-3 grid gap-3">
        {g.corrections.map((c) => {
          const s = CORRECTION_STATUS[c.status] ?? { text: c.status, tone: "plain" as Tone };
          return (
            <li
              key={c.id}
              id={`correction-${c.id}`}
              className="grid gap-2 rounded-md border p-4 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={s.tone}>{s.text}</StatusBadge>
                <span className="text-muted-foreground">
                  {`${c.preparedByGuard ? "Prepared by Bug Guard" : "Prepared"} ${when(c.createdAt)}`}
                  {c.appliedAt && `, applied ${when(c.appliedAt)}`}
                  {c.undoneAt && `, undone ${when(c.undoneAt)}`}
                </span>
              </div>
              <p lang="bn" className="font-medium break-words">
                {c.title}
              </p>
              <p lang="bn" className="break-words whitespace-pre-wrap">
                {c.summary}
              </p>
              {c.error && <p className="text-destructive">{c.error}</p>}
              <div className="flex flex-wrap gap-2">
                {c.status === "PREPARED" && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        pinned(
                          (pin) => applyCorrectionAction(c.id, { pin }),
                          "Backing up first; the correction is applied when the backup is done. You will hear on Telegram.",
                        )
                      }
                    >
                      <WrenchIcon aria-hidden />
                      Apply
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => cancelCorrectionAction(c.id),
                          () => "Cancelled: nothing changed.",
                        )
                      }
                    >
                      <RotateCcwIcon aria-hidden />
                      Cancel
                    </Button>
                  </>
                )}
                {c.status === "APPLIED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      pinned(
                        (pin) => undoCorrectionAction(c.id, { pin }),
                        "Undone: the opposite record is in, so it is back as it was.",
                      )
                    }
                  >
                    <Undo2Icon aria-hidden />
                    Undo
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SchedulePanel({ g, setMessage }: { g: Screen; setMessage: (m: Message) => void }) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ScheduleDraft>({
    mode: g.settings.schedule.mode,
    every: g.settings.schedule.every,
    times: g.settings.schedule.times,
    weekdays: g.settings.schedule.weekdays,
    dates: g.settings.schedule.dates,
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const scheduleError = Object.entries(errors).find(([k]) => k.startsWith("schedule"))?.[1]?.[0];
  return (
    <Panel title="When Bug Guard checks" id="guard-schedule-heading">
      <form
        className="mt-3 grid gap-5 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await saveBugGuardSettingsAction({
              schedule: scheduleInput(draft),
              weeklyDay: Number(form.get("weeklyDay")),
              weeklyTime: String(form.get("weeklyTime") ?? ""),
              autoPrepare: form.get("autoPrepare") === "on",
            });
            setErrors(result.ok ? {} : (result.error.fieldErrors ?? {}));
            setMessage(
              result.ok
                ? { tone: "success", text: `Saved: ${result.data.schedule}.` }
                : { tone: "error", text: result.error.message },
            );
          });
        }}
      >
        <p className="text-muted-foreground">{`Now: ${g.settings.scheduleText} (${g.settings.timezone} time).`}</p>
        <ScheduleFields id="guard" value={draft} onChange={setDraft} error={scheduleError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="guard-weekly-day" label="Weekly summary on" error={errors.weeklyDay?.[0]}>
            <select
              id="guard-weekly-day"
              name="weeklyDay"
              className="h-9 w-full rounded-md border bg-background px-3"
              defaultValue={g.settings.weeklyDay}
            >
              {WEEKDAY_NAMES.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
          <Field id="guard-weekly-time" label="At" error={errors.weeklyTime?.[0]}>
            <Input
              id="guard-weekly-time"
              name="weeklyTime"
              type="time"
              defaultValue={g.settings.weeklyTime}
            />
          </Field>
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="autoPrepare"
            defaultChecked={g.settings.autoPrepare}
            className="mt-1"
          />
          <span>
            Open fix pull requests and prepare data corrections by itself
            <span className="block text-muted-foreground">
              Off by default. Applying a correction and merging a fix always wait for you and your
              PIN.
            </span>
          </span>
        </label>
        <div>
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        </div>
      </form>
    </Panel>
  );
}
