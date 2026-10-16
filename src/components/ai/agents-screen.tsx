"use client";

import { BotIcon, PowerIcon, PowerOffIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { SKILL_TONES } from "@/components/ai/skills-list";
import { useWhen } from "@/components/ai/when";
import { FormAlert } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import type { AiAgentsScreen } from "@/modules/ai/agents.service";
import { setAgentOnAction } from "@/server/actions/ai.actions";

/*
 * AI Center > Agents: Mehedi 2.0 at the top and every agent under him. Each
 * card says what the agent does, its model and provider, whether it is on, its
 * Control cells, skills, books and test, today's and this month's cost, and
 * its last runs. The owner switches an agent off or on here; Mehedi 2.0
 * follows the main switch on AI Home.
 */

type Agent = AiAgentsScreen["agents"][number];

const CELL_TONES: Record<string, Tone> = { DO: "done", ASK: "open", OFF: "closed" };
const CELL_TEXT: Record<string, string> = { DO: "Do", ASK: "Ask", OFF: "Off" };

const BOOK_TONES: Record<string, Tone> = {
  PASSED: "done",
  FAILED: "warn",
  EXPIRED: "warn",
  CHANGED: "warn",
  RUNNING: "open",
  NONE: "plain",
};

const RESULT_TEXT: Record<string, string> = { OK: "Done", FAILED: "Failed", STOPPED: "Stopped" };

function stateOf(a: Agent): { tone: Tone; text: string } {
  if (a.on) return { tone: "done", text: "On" };
  if (a.switchedOff) return { tone: "closed", text: "Switched off" };
  return { tone: "closed", text: "AI off" };
}

function Costs({ a, currency }: { a: Agent; currency: string }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-muted-foreground">Today</dt>
        <dd className="font-medium tabular-nums">
          {money(a.today.cost, currency)}{" "}
          <span className="font-normal text-muted-foreground">({a.today.calls} calls)</span>
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">This month</dt>
        <dd className="font-medium tabular-nums">
          {money(a.month.cost, currency)}{" "}
          <span className="font-normal text-muted-foreground">({a.month.calls} calls)</span>
        </dd>
      </div>
    </dl>
  );
}

function ModelLine({ a }: { a: Agent }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Model: </span>
      {a.model.each ? (
        <>Each task&apos;s own model</>
      ) : (
        <>
          {a.model.label} <span className="text-muted-foreground">({a.model.provider})</span>
          {!a.model.own && <span className="text-muted-foreground"> · the task&apos;s model</span>}
        </>
      )}
      {a.modelTest && (
        <>
          {" "}
          <StatusBadge tone={a.modelTest.state === "PASSED" ? "done" : "warn"}>
            {a.modelTest.text}
          </StatusBadge>
        </>
      )}
      {" · "}
      <Link href="/ai/models" className="underline underline-offset-4">
        Models
      </Link>
    </p>
  );
}

function Details({ a, currency }: { a: Agent; currency: string }) {
  const when = useWhen();
  return (
    <div className="grid gap-4 text-sm">
      {!a.head && (
        <div>
          <h4 className="font-medium">Control cells</h4>
          {a.cells.list.length === 0 ? (
            <p className="text-muted-foreground">None: it only explains and changes nothing.</p>
          ) : (
            <ul className="mt-1 grid gap-1.5">
              {a.cells.list.map((c) => (
                <li key={c.key} className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={CELL_TONES[c.state] ?? "plain"}>
                    {CELL_TEXT[c.state] ?? c.state}
                  </StatusBadge>
                  <span>{c.label}</span>
                  {c.why && <span className="text-muted-foreground">({c.why})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div>
        <h4 className="font-medium">Skills</h4>
        {a.skills.length === 0 ? (
          <p className="text-muted-foreground">No skills taught yet.</p>
        ) : (
          <ul className="mt-1 grid gap-1.5">
            {a.skills.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={SKILL_TONES[s.standing]}>{s.text}</StatusBadge>
                <Link href={`/ai/skills/${s.id}`} className="underline underline-offset-4">
                  {s.name}
                </Link>
                <span className="text-muted-foreground">
                  version {s.version}
                  {s.on ? "" : " · switched off"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/ai/skills?agent=${encodeURIComponent(a.key)}`}
          className="mt-1 inline-block underline underline-offset-4"
        >
          Skills of {a.name}
        </Link>
      </div>
      {a.books.length > 0 && (
        <div>
          <h4 className="font-medium">Books</h4>
          <ul className="mt-1 grid gap-1.5 sm:grid-cols-2">
            {a.books.map((b) => (
              <li key={b.code} className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={BOOK_TONES[b.state] ?? "plain"}>{b.text}</StatusBadge>
                <Link href={`/ai/knowledge/${b.code}`} className="underline underline-offset-4">
                  {b.code} {b.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="font-medium">Last runs</h4>
        {a.last.length === 0 ? (
          <p className="text-muted-foreground">No runs yet.</p>
        ) : (
          <ul className="mt-1 divide-y">
            {a.last.map((l) => (
              <li key={l.id} className="grid gap-0.5 py-1.5">
                <span>
                  {l.why}
                  {l.record &&
                    (l.href ? (
                      <>
                        {" · "}
                        <Link href={l.href} className="underline underline-offset-4">
                          {l.record}
                        </Link>
                      </>
                    ) : (
                      ` · ${l.record}`
                    ))}
                </span>
                <span className="text-[0.8125rem] text-muted-foreground">
                  {when(l.at)} · {l.task} · {l.model} · {RESULT_TEXT[l.result] ?? l.result}
                  {l.cost === null ? " · Price unknown" : ` · ${money(l.cost, currency)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AgentsScreen({ screen: s }: { screen: AiAgentsScreen }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();
  const head = s.agents.find((a) => a.head);
  const under = s.agents.filter((a) => !a.head);

  const toggle = (a: Agent) =>
    startTransition(async () => {
      const on = a.switchedOff;
      const result = await setAgentOnAction({ agent: a.key, on });
      setMessage(
        result.ok
          ? {
              tone: "success",
              text: on
                ? `${a.name} is switched on.`
                : `${a.name} is switched off: it does no work.`,
            }
          : { tone: "error", text: result.error.message },
      );
    });

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      {s.aiText && <FormAlert tone="note">{s.aiText} No agent works until AI is on.</FormAlert>}

      {head && (
        <section
          aria-labelledby="agent-head-heading"
          className="grid gap-4 rounded-lg border bg-card p-5 sm:p-6"
        >
          <div className="flex min-w-0 gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <BotIcon aria-hidden className="size-5" />
            </span>
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="agent-head-heading" className="font-serif text-xl text-primary">
                  {head.name}
                </h2>
                <StatusBadge tone={stateOf(head).tone}>{stateOf(head).text}</StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">
                {head.what}. He follows the main switch on{" "}
                <Link href="/ai" className="underline underline-offset-4">
                  AI Home
                </Link>
                ; his profile is on{" "}
                <Link href="/ai/mehedi" className="underline underline-offset-4">
                  Mehedi 2.0
                </Link>
                .
              </p>
            </div>
          </div>
          <ModelLine a={head} />
          {head.cells.every && (
            <p className="text-sm">
              <span className="text-muted-foreground">Control: </span>
              {head.cells.every.DO} Do, {head.cells.every.ASK} Ask, {head.cells.every.OFF} Off ·{" "}
              <Link href="/ai/control" className="underline underline-offset-4">
                Control
              </Link>
            </p>
          )}
          <Costs a={head} currency={s.currency} />
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-primary">
              Skills, books and last runs
            </summary>
            <div className="mt-3">
              <Details a={head} currency={s.currency} />
            </div>
          </details>
        </section>
      )}

      <Panel title="The agents under him" id="agents-under-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          The tech pack experts, the orchestrator, the review board and the Help AI. A switched-off
          agent does no work, and what needs it waits. Costs are in{" "}
          <Link href="/ai/costs" className="underline underline-offset-4">
            Budget &amp; Costs
          </Link>
          .
        </p>
        <ul className="mt-4 grid gap-4 lg:grid-cols-2">
          {under.map((a) => {
            const state = stateOf(a);
            return (
              <li key={a.key} className="grid content-start gap-3 rounded-md border p-4">
                {/* The switch keeps its place at the top right of every card. */}
                <div className="flex items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{a.name}</h3>
                      <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
                    </div>
                    <p className="text-sm text-muted-foreground">{a.what}</p>
                  </div>
                  {s.can.manage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={pending}
                      onClick={() => toggle(a)}
                    >
                      {a.switchedOff ? <PowerIcon aria-hidden /> : <PowerOffIcon aria-hidden />}
                      {a.switchedOff ? "Switch on" : "Switch off"}
                    </Button>
                  )}
                </div>
                <ModelLine a={a} />
                <p className="text-sm">
                  <span className="text-muted-foreground">Skills: </span>
                  {a.skills.length === 0
                    ? "none yet"
                    : `${a.skills.length} (${a.skills.filter((k) => k.standing === "PASSED").length} passed)`}
                </p>
                <Costs a={a} currency={s.currency} />
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    Control, skills and last runs
                  </summary>
                  <div className="mt-3">
                    <Details a={a} currency={s.currency} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
