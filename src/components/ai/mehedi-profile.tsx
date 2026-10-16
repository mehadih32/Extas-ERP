"use client";

import { BotIcon, CheckIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { AiLogList } from "@/components/ai/log-list";
import { useDay } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { MehediScreen } from "@/modules/ai/mehedi.service";
import { setAiPausedAction } from "@/server/actions/ai.actions";
import {
  decideHouseRuleAction,
  proposeHouseRuleAction,
  retireHouseRuleAction,
} from "@/server/actions/mehedi.actions";

/*
 * AI Center > Mehedi 2.0: the owner's AI copy at a glance (identity, limits,
 * Control, budget, tests, last work), the Pause button, and Teach: the owner's
 * standing rules as House Rule proposals that count once approved.
 */

const TEST_TONES: Record<string, Tone> = {
  PASSED: "done",
  FAILED: "warn",
  EXPIRED: "warn",
  CHANGED: "warn",
  RUNNING: "open",
  NONE: "plain",
};

const SCOPES = [
  { value: "ALL", label: "Everything" },
  { value: "BUYER", label: "A buyer" },
  { value: "BRAND", label: "A brand" },
  { value: "ITEM", label: "An item" },
] as const;

const scopeText = (r: { scope: string; scopeValue: string | null }) =>
  r.scope === "ALL"
    ? "Everything"
    : `${SCOPES.find((s) => s.value === r.scope)?.label ?? r.scope}: ${r.scopeValue ?? ""}`;

export function MehediProfile({ profile: m }: { profile: MehediScreen }) {
  const day = useDay();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const [teaching, setTeaching] = useState(false);
  const [scope, setScope] = useState<string>("ALL");

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
    });

  const stateTone: Tone = m.state === "on" ? "done" : m.state === "paused" ? "warn" : "closed";
  const stateLabel =
    m.state === "on"
      ? "On"
      : m.state === "paused"
        ? "Paused"
        : m.state === "no-key"
          ? "No key"
          : "Off";

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <section
        aria-labelledby="mehedi-heading"
        className="grid gap-4 rounded-lg border bg-card p-5 sm:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <BotIcon aria-hidden className="size-5" />
            </span>
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="mehedi-heading" className="font-serif text-xl text-primary">
                  {m.shownName}
                </h2>
                <StatusBadge tone={stateTone}>{stateLabel}</StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">
                Expert {m.expertId}: your AI copy and head of the experts X01 to X25. Everything he
                writes is labelled &ldquo;{m.label}&rdquo;. {m.stateText}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/ai/chat">Chat with him</Link>
            </Button>
            {m.can.manage && m.enabled && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setAiPausedAction(!m.paused),
                    m.paused ? "He works again." : "Paused: no AI work runs.",
                  )
                }
              >
                {m.paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
                {m.paused ? "Resume" : "Pause"}
              </Button>
            )}
          </div>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-muted-foreground">Do / Ask / Off</dt>
            <dd className="font-medium tabular-nums">
              {m.control.DO} / {m.control.ASK} / {m.control.OFF}
              {m.control.granted > 0 && ` (${m.control.granted} opened for now)`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">AI cost today</dt>
            <dd className="font-medium tabular-nums">
              <Link href="/ai/costs?period=today" className="underline-offset-4 hover:underline">
                {m.month.currency} {m.month.today.spent}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">AI cost this month</dt>
            <dd className="font-medium tabular-nums">
              {m.month.currency} {m.month.spent}
              {m.month.budget ? ` of ${m.month.budget}` : " (no budget set)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tests passed</dt>
            <dd className="font-medium tabular-nums">
              {m.tests.passed} of {m.tests.total}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Waiting for you</dt>
            <dd className="font-medium">
              <Link href="/ai/drafts" className="underline underline-offset-4">
                {m.waiting.drafts} drafts
              </Link>
              {", "}
              <Link href="/ai" className="underline underline-offset-4">
                {m.waiting.permissions + m.waiting.deletions} requests
              </Link>
            </dd>
          </div>
        </dl>
        <p className="text-[0.8125rem] text-muted-foreground">
          What he may do is set in{" "}
          <Link href="/ai/control" className="underline underline-offset-4">
            Control
          </Link>
          . A Do cell stays Ask until he has passed the tests of the books it needs.
        </p>
      </section>

      <Panel title="What he never does" id="mehedi-limits-heading">
        <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-sm">
          {m.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Tests"
        id="mehedi-tests-heading"
        action={
          <Link href="/ai/knowledge" className="text-sm underline underline-offset-4">
            Books &amp; tests
          </Link>
        }
      >
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {m.tests.books.map((b) => (
            <li key={b.code} className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={TEST_TONES[b.state] ?? "plain"}>{b.text}</StatusBadge>
              <Link href={`/ai/knowledge/${b.code}`} className="underline underline-offset-4">
                {b.title}
              </Link>
              {b.last && (
                <span className="text-muted-foreground tabular-nums">
                  {b.last.right}/{b.last.total}
                  {b.validUntil ? `, until ${day(b.validUntil)}` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Teach"
        id="teach"
        action={
          m.can.manage && (
            <Button type="button" size="sm" onClick={() => setTeaching(true)}>
              Teach a rule
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          Your standing rules (&ldquo;placket 3 cm on all Lacoste polos&rdquo;). A rule counts only
          once you approve it, and then wins over his books. In the chat, start with
          &ldquo;নিয়ম:&rdquo; or &ldquo;Rule:&rdquo;.
        </p>
        {!m.rules ? (
          <p className="mt-3 text-sm text-muted-foreground">Only the owner sees the House Rules.</p>
        ) : (
          <div className="mt-4 grid gap-5">
            {m.rules.proposed.length > 0 && (
              <div className="grid gap-2">
                <h4 className="text-sm font-medium">To approve</h4>
                <ul className="grid gap-2">
                  {m.rules.proposed.map((r) => (
                    <li key={r.id} className="grid gap-2 rounded-md border p-3 text-sm">
                      <p className="font-medium">{r.text}</p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {scopeText(r)} · from {r.source}
                        {r.byAi ? ` (worded by ${m.label})` : ""}
                        {r.said && r.said !== r.text ? ` · you said: “${r.said}”` : ""}
                      </p>
                      {r.sameThing.length > 0 && (
                        <p className="text-[0.8125rem] text-destructive">
                          Rules already on the same thing:{" "}
                          {r.sameThing.map((o) => `“${o.text}”`).join("; ")}
                        </p>
                      )}
                      {m.can.manage && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => decideHouseRuleAction(r.id, { approve: true }),
                                "Approved: it counts from now.",
                              )
                            }
                          >
                            <CheckIcon aria-hidden />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => decideHouseRuleAction(r.id, { approve: false }),
                                "Rejected.",
                              )
                            }
                          >
                            <XIcon aria-hidden />
                            Reject
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-2">
              <h4 className="text-sm font-medium">House Rules in use</h4>
              {m.rules.approved.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet.</p>
              ) : (
                <ul className="grid gap-2">
                  {m.rules.approved.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p>{r.text}</p>
                        <p className="text-[0.8125rem] text-muted-foreground">
                          {scopeText(r)} · approved {day(r.decidedAt)}
                          {r.decidedBy ? ` by ${r.decidedBy}` : ""}
                        </p>
                      </div>
                      {m.can.manage && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            run(() => retireHouseRuleAction(r.id), "Retired: it no longer counts.")
                          }
                        >
                          Retire
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {m.rules.past.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Rejected and retired ({m.rules.past.length})
                </summary>
                <ul className="mt-2 grid gap-1">
                  {m.rules.past.map((r) => (
                    <li key={r.id} className="text-muted-foreground">
                      {r.status === "RETIRED" ? "Retired" : "Rejected"}: {r.text}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="What he did last"
        id="mehedi-work-heading"
        action={
          <Link href="/ai/logs" className="text-sm underline underline-offset-4">
            All logs
          </Link>
        }
      >
        <AiLogList items={m.work} empty="Nothing yet. His work shows here, marked AI." />
      </Panel>

      {teaching && (
        <FormDialog
          title="Teach a rule"
          description="Write the rule as you would tell a merchandiser. It is saved as a proposal; approve it to make it count."
          submitLabel="Save the proposal"
          pendingLabel="Saving"
          errorTitle="We could not save the rule"
          onClose={() => setTeaching(false)}
          onSubmit={async (form) => {
            const result = await proposeHouseRuleAction({
              text: String(form.get("text") ?? ""),
              scope: String(form.get("scope") ?? "ALL"),
              scopeValue: String(form.get("scopeValue") ?? ""),
            });
            if (!result.ok) return result.error;
            setMessage({
              tone: "success",
              text: "Saved as a proposal: approve it below to make it count.",
            });
            setTeaching(false);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field id="rule-text" label="Rule" error={fieldError("text")}>
                <Textarea id="rule-text" name="text" rows={3} maxLength={500} required />
              </Field>
              <Field id="rule-scope" label="For" error={fieldError("scope")}>
                <NativeSelect
                  id="rule-scope"
                  name="scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  containerClassName="sm:w-full"
                >
                  {SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {scope !== "ALL" && (
                <Field id="rule-scope-value" label="Which one" error={fieldError("scopeValue")}>
                  <Input id="rule-scope-value" name="scopeValue" maxLength={120} required />
                </Field>
              )}
            </div>
          )}
        </FormDialog>
      )}
    </div>
  );
}
