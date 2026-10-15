"use client";

import { BookOpenIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { askFirstOf } from "@/components/ai/ask-first";
import { useDay } from "@/components/ai/when";
import { FormAlert } from "@/components/forms/field";
import { StatusBadge, type Tone } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { KnowledgeScreen as Knowledge } from "@/modules/ai/knowledge.service";
import { startTestsAction } from "@/server/actions/mehedi.actions";

/*
 * AI Center > Books & tests: the books Mehedi 2.0 works from (K1–K5 and his
 * own X26) and his tests. A pass counts for a month and for the book's text as
 * it was; until he passes the books an action needs, its Do cell stays Ask.
 */

export const TEST_TONES: Record<string, Tone> = {
  PASSED: "done",
  FAILED: "warn",
  EXPIRED: "warn",
  CHANGED: "warn",
  RUNNING: "open",
  NONE: "plain",
};

export function KnowledgeScreen({ knowledge: k }: { knowledge: Knowledge }) {
  const day = useDay();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [asked, setAsked] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "note"; text: string }>();

  const start = (costOk: boolean) =>
    startTransition(async () => {
      const result = await startTestsAction({ books: picked, costOk });
      if (result.ok) {
        setAsked(null);
        setPicked([]);
        setMessage({
          tone: "success",
          text: "The tests are running. Come back in a few minutes for the marks.",
        });
        return;
      }
      const first = askFirstOf(result.error);
      if (first) {
        setAsked(first);
        setMessage(undefined);
      } else setMessage({ tone: "error", text: result.error.message });
    });

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
      <Panel
        title="Books & tests"
        id="books-heading"
        action={
          k.can.manage && (
            <Button
              type="button"
              size="sm"
              disabled={pending || picked.length === 0}
              onClick={() => start(false)}
            >
              <PlayIcon aria-hidden />
              Run the tests ({picked.length})
            </Button>
          )
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          He passes a test with 7 answers right out of 8. A pass counts for {k.validDays} days and
          only for the book as it is: change a book and he takes its test again. Until he passes,
          his Do cells stay Ask.
        </p>
        {asked && (
          <div className="mt-4 grid gap-2 rounded-md border border-primary/30 bg-secondary p-3 text-sm">
            <p>{asked}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => start(true)}>
                Go on
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAsked(null)}>
                Not now
              </Button>
            </div>
          </div>
        )}
        <ul className="mt-4 grid gap-3">
          {k.books.map((b) => (
            <li
              key={b.code}
              className="grid gap-2 rounded-md border p-4 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-start"
            >
              {k.can.manage ? (
                <Checkbox
                  aria-label={`Test ${b.title}`}
                  checked={picked.includes(b.code)}
                  disabled={b.test.running}
                  onCheckedChange={(on) =>
                    setPicked((now) => (on ? [...now, b.code] : now.filter((c) => c !== b.code)))
                  }
                  className="mt-1"
                />
              ) : (
                <BookOpenIcon aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <Link
                  href={`/ai/knowledge/${b.code}`}
                  className="font-medium underline underline-offset-4"
                >
                  {b.title}
                </Link>
                <p className="text-muted-foreground">{b.about}</p>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {b.questions} questions, pass mark {b.passMark}
                  {b.own ? ` · your own text, changed ${day(b.updatedAt)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <StatusBadge tone={TEST_TONES[b.test.state] ?? "plain"}>{b.test.text}</StatusBadge>
                {b.test.last && (
                  <span className="text-muted-foreground tabular-nums">
                    {b.test.last.right}/{b.test.last.total}
                    {b.test.validUntil ? `, until ${day(b.test.validUntil)}` : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
