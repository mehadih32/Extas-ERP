"use client";

import { ArrowLeftIcon, PenLineIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { TEST_TONES } from "@/components/ai/knowledge-screen";
import { useWhen } from "@/components/ai/when";
import { Field, FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BookScreen as Book } from "@/modules/ai/knowledge.service";
import { resetBookAction, saveBookAction } from "@/server/actions/mehedi.actions";

/*
 * One book: its text (the owner may change it for this company; the test is
 * then taken again), its questions with the expected answers, and the last
 * test runs with each answer and its mark.
 */

export function BookScreen({ book: b }: { book: Book }) {
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string }>();

  return (
    <div className="grid gap-6">
      <Link
        href="/ai/knowledge"
        className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
      >
        <ArrowLeftIcon aria-hidden className="size-3.5" />
        Books &amp; tests
      </Link>
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <Panel
        title={b.title}
        id="book-heading"
        action={
          b.can.manage && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                <PenLineIcon aria-hidden />
                Change the text
              </Button>
              {b.own && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await resetBookAction(b.code);
                      setMessage(
                        result.ok
                          ? {
                              tone: "success",
                              text: "Back to the shipped text. He takes the test again.",
                            }
                          : { tone: "error", text: result.error.message },
                      );
                    })
                  }
                >
                  <RotateCcwIcon aria-hidden />
                  Back to the shipped text
                </Button>
              )}
            </div>
          )
        }
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={TEST_TONES[b.test.state] ?? "plain"}>{b.test.text}</StatusBadge>
          <span className="text-muted-foreground">
            {b.about}
            {b.own
              ? ` · your own text, changed ${when(b.updatedAt)}`
              : " · the text shipped with the app"}
          </span>
        </div>
        <pre className="mt-4 max-h-[28rem] overflow-auto rounded-md bg-muted/40 p-4 font-sans text-[0.8125rem] leading-relaxed wrap-anywhere whitespace-pre-wrap">
          {b.text}
        </pre>
      </Panel>

      <Panel
        title={`Test questions (pass mark ${b.passMark} of ${b.questions.length})`}
        id="book-questions-heading"
      >
        <ol className="mt-3 grid list-decimal gap-3 pl-5 text-sm">
          {b.questions.map((q) => (
            <li key={q.n}>
              <p className="font-medium wrap-anywhere">{q.q}</p>
              <p className="wrap-anywhere text-muted-foreground">Expected: {q.v62 ?? q.expected}</p>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Last test runs" id="book-runs-heading">
        {b.runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Not taken yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {b.runs.map((r) => (
              <li key={r.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={r.status === "RUNNING" ? "open" : r.passed ? "done" : "warn"}>
                    {r.status === "RUNNING"
                      ? "Running"
                      : r.status === "FAILED"
                        ? "Could not finish"
                        : r.passed
                          ? "Passed"
                          : "Not passed"}
                  </StatusBadge>
                  <span className="tabular-nums">
                    {r.right}/{r.total}
                  </span>
                  <span className="text-muted-foreground">
                    {when(r.finishedAt ?? r.createdAt)}
                    {r.by ? ` · started by ${r.by}` : ""}
                    {!r.sameText ? " · an older text of the book" : ""}
                  </span>
                </div>
                {r.error && <p className="mt-1 text-[0.8125rem] text-destructive">{r.error}</p>}
                {r.answers.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.8125rem] text-muted-foreground">
                      His answers
                    </summary>
                    <ol className="mt-2 grid gap-2">
                      {r.answers.map((a) => (
                        <li key={a.n} className="grid gap-0.5 text-[0.8125rem]">
                          <p>
                            <span className={a.right ? "text-primary" : "text-destructive"}>
                              {a.right ? "Right" : "Wrong"}
                            </span>{" "}
                            {a.n}. {a.q}
                          </p>
                          <p className="wrap-anywhere whitespace-pre-wrap">{a.answer}</p>
                          <p className="wrap-anywhere text-muted-foreground">{a.why}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <FormDialog
          title={`Change ${b.code}`}
          description="Your text is used for this company from now on, and he takes the test again before his Do cells count."
          submitLabel="Save the text"
          pendingLabel="Saving"
          errorTitle="We could not save the book"
          className="sm:max-w-4xl"
          onClose={() => setEditing(false)}
          onSubmit={async (form) => {
            const result = await saveBookAction(b.code, { text: String(form.get("text") ?? "") });
            if (!result.ok) return result.error;
            setMessage({ tone: "success", text: "Saved. He takes the test of this book again." });
            setEditing(false);
          }}
        >
          {(fieldError) => (
            <Field id="book-text" label="Text" error={fieldError("text")}>
              <Textarea
                id="book-text"
                name="text"
                rows={20}
                defaultValue={b.text}
                className="font-mono text-xs"
                required
              />
            </Field>
          )}
        </FormDialog>
      )}
    </div>
  );
}
