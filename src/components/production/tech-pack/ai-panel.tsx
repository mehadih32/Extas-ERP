"use client";

import {
  CheckIcon,
  MessageCircleQuestionIcon,
  PencilIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { useState, useTransition } from "react";

import { askFirstOf } from "@/components/ai/ask-first";
import { Field, FormAlert } from "@/components/forms/field";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { TechPackScreen } from "@/modules/production/tech-pack-screen.service";
import {
  askExpertAction,
  decideDraftLineAction,
  draftTechPackAction,
  runReviewBoardAction,
  setInstructionsAction,
} from "@/server/actions/tech-pack.actions";

import { type Signal, SignalMark } from "./signals";

/*
 * Tech pack AI on the style: the owner's instructions for the AI (they
 * outrank its guesses), the AI draft with each line green, yellow or red and
 * OK or Change on it, the questions it asks and how it used each instruction,
 * Ask an expert and the light review board. The AI drafts and advises; nothing
 * in the tech pack changes by it.
 */

const RESULT_TEXT = {
  applied: { mark: "✓", label: "applied", tone: "text-success" },
  conflict: { mark: "⚠", label: "conflict: needs you", tone: "text-amber-700 dark:text-amber-400" },
  not_applied: { mark: "✗", label: "not applied", tone: "text-destructive" },
} as const;

const SEVERITY: Record<string, Signal> = { red: "red", yellow: "yellow", info: "green" };

/** Runs an AI action; when the owner wants to be asked first, shows the estimate and a Go on. */
function useAiRun() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [askFirst, setAskFirst] = useState<{ text: string; again: () => void } | null>(null);
  const run = (
    work: (costOk: boolean) => Promise<{ ok: true } | { ok: false; error: ActionError }>,
    done?: () => void,
  ) => {
    const go = (costOk: boolean) =>
      startTransition(async () => {
        const result = await work(costOk);
        if (result.ok) {
          setError(undefined);
          setAskFirst(null);
          done?.();
          return;
        }
        const text = askFirstOf(result.error);
        if (text && !costOk) {
          setAskFirst({ text, again: () => go(true) });
          setError(undefined);
        } else {
          setError(result.error);
          setAskFirst(null);
        }
      });
    go(false);
  };
  return { pending, error, askFirst, run, clear: () => setAskFirst(null) };
}

function AskFirst({ state, pending }: { state: ReturnType<typeof useAiRun>; pending: boolean }) {
  if (!state.askFirst) return null;
  return (
    <FormAlert tone="note">
      <p>{state.askFirst.text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={state.askFirst.again}>
          Go on
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={state.clear}>
          Not now
        </Button>
      </div>
    </FormAlert>
  );
}

export function AiPanel({ screen }: { screen: TechPackScreen }) {
  const { project, draft, can, aiOn } = screen;
  const [mode, setMode] = useState<"ASK" | "AUTO">("ASK");
  const [asking, setAsking] = useState<
    | { kind: "instructions" }
    | { kind: "change"; index: number; text: string }
    | { kind: "expert" }
    | null
  >(null);
  const drafting = useAiRun();
  const reviewing = useAiRun();
  const [pending, startTransition] = useTransition();
  const [lineError, setLineError] = useState<ActionError>();
  const [expertCostOk, setExpertCostOk] = useState(false);
  const instructions = Object.entries(screen.instructions);
  const review = draft?.output.review ?? null;
  const reviews = screen.answers.filter((a) => a.kind === "REVIEW");
  const answers = screen.answers.filter((a) => a.kind === "QUESTION");
  const latestReview = reviews[0] ?? null;

  const ok = (index: number) =>
    startTransition(async () => {
      const result = await decideDraftLineAction(project.id, draft!.id, { index, decision: "OK" });
      setLineError(result.ok ? undefined : result.error);
    });

  return (
    <>
      <Panel
        title="Instructions for AI"
        id="tech-pack-instructions-heading"
        action={
          can.edit ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAsking({ kind: "instructions" })}
            >
              <PencilIcon aria-hidden />
              Write instructions
            </Button>
          ) : null
        }
      >
        {instructions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            None yet. The AI reads them before it drafts, and they outrank its own guesses; where
            one disagrees with the buyer&apos;s file it shows both in red for you to decide.
          </p>
        ) : (
          <dl className="mt-3 grid gap-3 text-sm">
            {instructions.map(([section, text]) => (
              <div key={section}>
                <dt className="font-medium">{section}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>

      <Panel title="AI draft" id="tech-pack-ai-draft-heading">
        {!aiOn && (
          <p className="mt-3 text-sm text-muted-foreground">
            AI is switched off. The owner turns it on in AI Center; until then the tech pack is
            filled in by hand.
          </p>
        )}
        {can.ai && (
          <div className="mt-3 grid gap-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              The AI reads the saved references, the materials per piece, the chart and your
              instructions, and drafts the tech pack. Ask: it stops at what it is unsure of and
              asks. Auto: it leaves those yellow, then the review board checks the draft.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="Mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as "ASK" | "AUTO")}
              >
                <option value="ASK">Ask</option>
                <option value="AUTO">Auto</option>
              </NativeSelect>
              <Button
                type="button"
                size="sm"
                disabled={drafting.pending}
                onClick={() =>
                  drafting.run((costOk) => draftTechPackAction(project.id, { mode, costOk }))
                }
              >
                <SparklesIcon aria-hidden />
                {drafting.pending ? "Drafting" : draft ? "Draft again" : "Draft with AI"}
              </Button>
            </div>
            <AskFirst state={drafting} pending={drafting.pending} />
            {drafting.error && <FormAlert>{drafting.error.message}</FormAlert>}
          </div>
        )}
        {draft && (
          <div className="mt-5 grid gap-4">
            <div>
              <p className="eyebrow">
                {draft.mode === "AUTO" ? "Auto" : "Ask"} draft
                {draft.createdBy ? ` by ${draft.createdBy}` : ""}
              </p>
              <p className="mt-1 font-medium">{draft.output.item}</p>
            </div>
            <ul className="grid divide-y rounded-md border">
              {draft.output.lines.map((line, index) => {
                const signal: Signal = line.decision ? "green" : line.signal;
                return (
                  <li key={`${index}-${line.text}`} className="flex items-start gap-3 p-3">
                    <SignalMark signal={signal} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.75rem] text-muted-foreground">{line.section}</p>
                      <p className="text-sm break-words">{line.text}</p>
                      {line.why && !line.decision && (
                        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{line.why}</p>
                      )}
                      {line.decision && (
                        <p className="mt-0.5 text-[0.75rem] text-success">
                          {line.decision === "OK" ? "OK" : "Changed"}
                        </p>
                      )}
                    </div>
                    {can.edit && !line.decision && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => ok(index)}
                        >
                          <CheckIcon aria-hidden />
                          OK
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAsking({ kind: "change", index, text: line.text })}
                        >
                          Change
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {lineError && <FormAlert>{lineError.message}</FormAlert>}
            {draft.output.questions.length > 0 && (
              <div>
                <h4 className="text-sm font-medium">Questions from the AI</h4>
                <ul className="mt-1 grid list-disc gap-1 pl-5 text-sm">
                  {draft.output.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {draft.output.rules.length > 0 && (
              <div>
                <h4 className="text-sm font-medium">Rules applied</h4>
                <ul className="mt-1 grid gap-1.5 text-sm">
                  {draft.output.rules.map((r, i) => {
                    const t =
                      RESULT_TEXT[r.result as keyof typeof RESULT_TEXT] ?? RESULT_TEXT.not_applied;
                    return (
                      <li key={`${i}-${r.instruction}`} className="flex gap-2">
                        <span className={t.tone} aria-hidden>
                          {t.mark}
                        </span>
                        <span className="min-w-0 break-words">
                          <span className="text-muted-foreground">{r.section}:</span>{" "}
                          {r.instruction} <span className={t.tone}>({t.label})</span>
                          {r.note && (
                            <span className="block text-[0.8125rem] text-muted-foreground">
                              {r.note}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {review && (
              <ReviewFindings
                title="Review board on this draft"
                summary={review.summary}
                findings={review.findings}
              />
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Experts"
        id="tech-pack-experts-heading"
        action={
          can.ai ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAsking({ kind: "expert" })}
              >
                <MessageCircleQuestionIcon aria-hidden />
                Ask an expert
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reviewing.pending}
                onClick={() =>
                  reviewing.run((costOk) => runReviewBoardAction(project.id, { costOk }))
                }
              >
                <UsersIcon aria-hidden />
                {reviewing.pending ? "Reviewing" : "Run the review board"}
              </Button>
            </div>
          ) : null
        }
      >
        <div className="mt-3 grid gap-4">
          <AskFirst state={reviewing} pending={reviewing.pending} />
          {reviewing.error && <FormAlert>{reviewing.error.message}</FormAlert>}
          {latestReview && (
            <ReviewFindings
              title={`Review board${latestReview.askedBy ? `, asked by ${latestReview.askedBy}` : ""}`}
              summary={latestReview.answer}
              findings={latestReview.findings}
            />
          )}
          {answers.length === 0 && !latestReview ? (
            <p className="text-sm text-muted-foreground">
              Ask the pattern master, the fabric engineer, the QC manager or another expert about
              this style; or run the review board (the cutting master and the head merchandiser)
              before you approve.
            </p>
          ) : (
            <ul className="grid gap-4">
              {answers.map((a) => (
                <li key={a.id} className="rounded-md border p-3">
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {a.expert} · {screen.experts.find((e) => e.id === a.expert)?.name ?? "Expert"}
                    {a.askedBy ? `, asked by ${a.askedBy}` : ""}
                  </p>
                  <p className="mt-1 text-sm font-medium break-words">{a.question}</p>
                  <p className="mt-2 text-sm break-words whitespace-pre-line">{a.answer}</p>
                  {a.detail?.calculation && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        Calculation
                      </summary>
                      <p className="mt-1 whitespace-pre-line">{a.detail.calculation}</p>
                    </details>
                  )}
                  {a.detail && a.detail.risks.length > 0 && (
                    <ul className="mt-2 grid list-disc gap-1 pl-5 text-[0.8125rem]">
                      {a.detail.risks.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {a.detail && (
                    <p className="mt-2 text-[0.75rem] text-muted-foreground">
                      Confidence: {a.detail.confidence}
                      {a.detail.actions.length > 0 ? ` · Next: ${a.detail.actions.join("; ")}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {asking?.kind === "instructions" && (
        <FormDialog
          title="Instructions for AI"
          description="Read by the AI before every draft; they outrank its own guesses. Write in English or Bengali."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the instructions"
          className="sm:max-w-2xl"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await setInstructionsAction(project.id, Object.fromEntries(form));
            if (!result.ok) return result.error;
            setAsking(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              {screen.instructionSections.map((section) => (
                <Field
                  key={section}
                  id={`ins-${section}`}
                  label={section}
                  error={fieldError(section)}
                >
                  <Textarea
                    id={`ins-${section}`}
                    name={section}
                    rows={2}
                    defaultValue={screen.instructions[section] ?? ""}
                  />
                </Field>
              ))}
            </div>
          )}
        </FormDialog>
      )}

      {asking?.kind === "change" && draft && (
        <FormDialog
          title="Change the line"
          description="Your words replace the AI's; the line turns green."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not change the line"
          onClose={() => setAsking(null)}
          onSubmit={async (form) => {
            const result = await decideDraftLineAction(project.id, draft.id, {
              index: asking.index,
              decision: "CHANGE",
              text: String(form.get("text") ?? ""),
            });
            if (!result.ok) return result.error;
            setAsking(null);
          }}
        >
          {(fieldError) => (
            <Field id="line-text" label="The line" error={fieldError("text")}>
              <Textarea id="line-text" name="text" rows={3} defaultValue={asking.text} autoFocus />
            </Field>
          )}
        </FormDialog>
      )}

      {asking?.kind === "expert" && (
        <FormDialog
          title="Ask an expert"
          description="The expert reads this style as the ERP has it and answers: short answer, the working, the risks and how sure they are. Nothing changes by it."
          submitLabel={expertCostOk ? "Go on" : "Ask"}
          pendingLabel="Asking"
          errorTitle="We could not ask the expert"
          className="sm:max-w-xl"
          onClose={() => {
            setExpertCostOk(false);
            setAsking(null);
          }}
          onSubmit={async (form) => {
            const result = await askExpertAction(project.id, {
              expert: form.get("expert"),
              question: form.get("question"),
              costOk: expertCostOk,
            });
            if (!result.ok) {
              if (askFirstOf(result.error) && !expertCostOk) {
                setExpertCostOk(true);
                return {
                  code: "CONFLICT",
                  message: `${result.error.message} Press "Go on" to ask.`,
                };
              }
              return result.error;
            }
            setExpertCostOk(false);
            setAsking(null);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field
                id="expert-pick"
                label="Expert"
                hint="Let the AI pick: the question decides who answers."
                error={fieldError("expert")}
              >
                <NativeSelect
                  id="expert-pick"
                  name="expert"
                  defaultValue="AUTO"
                  containerClassName="sm:w-full"
                >
                  <option value="AUTO">Let the AI pick</option>
                  {screen.experts.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.id} · {e.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="expert-question" label="Question" error={fieldError("question")}>
                <Textarea id="expert-question" name="question" rows={4} required />
              </Field>
            </div>
          )}
        </FormDialog>
      )}
    </>
  );
}

function ReviewFindings({
  title,
  summary,
  findings,
}: {
  title: string;
  summary: string;
  findings: Array<{ seat: string; finding: string; severity: string }>;
}) {
  return (
    <div className="rounded-md border p-3">
      <h4 className="text-sm font-medium">{title}</h4>
      {summary && <p className="mt-1 text-sm text-muted-foreground">{summary}</p>}
      {findings.length > 0 && (
        <ul className="mt-2 grid gap-1.5 text-sm">
          {findings.map((f, i) => (
            <li key={`${i}-${f.finding}`} className="flex items-start gap-2">
              <SignalMark signal={SEVERITY[f.severity] ?? "yellow"} className="mt-0.5" />
              <span className="min-w-0 break-words">
                <span className="text-muted-foreground">{f.seat}:</span> {f.finding}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
