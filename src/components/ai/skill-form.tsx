"use client";

import { LoaderCircleIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import { MAX_EXAMPLES, type SkillExample } from "@/modules/ai/skills";
import { createSkillAction, updateSkillAction } from "@/server/actions/ai.actions";

/*
 * Teaching a skill in plain words (Bengali or English): its name, when to use
 * it, the steps, do's and don'ts, examples (each one is also a test question
 * with the right answer) and notes. A new skill is version 1; saving a change
 * makes the next version (the old ones stay, with Undo). Every new version is
 * tested again before the agent may use it on Do.
 */

export type SkillFormValues = {
  name: string;
  whenToUse: string;
  steps: string;
  dos: string | null;
  donts: string | null;
  examples: SkillExample[];
  notes: string | null;
};

type Props =
  | {
      mode: "new";
      agents: Array<{ key: string; name: string }>;
      agent: string | null;
      initial?: undefined;
      skillId?: undefined;
    }
  | {
      mode: "edit";
      skillId: string;
      initial: SkillFormValues;
      agents?: undefined;
      agent?: undefined;
    };

const EMPTY: SkillFormValues = {
  name: "",
  whenToUse: "",
  steps: "",
  dos: null,
  donts: null,
  examples: [],
  notes: null,
};

export function SkillForm(props: Props) {
  const router = useRouter();
  const start = props.initial ?? EMPTY;
  const [examples, setExamples] = useState<SkillExample[]>(
    start.examples.length ? start.examples : [{ situation: "", answer: "" }],
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  const [done, setDone] = useState<string>();
  // The rows sent (empty ones are left out), to show each error on its row.
  const [sent, setSent] = useState<number[]>([]);
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const exampleError = (i: number) => {
    const at = sent.indexOf(i);
    if (at < 0) return undefined;
    return (
      error?.fieldErrors?.[`examples.${at}.situation`]?.[0] ??
      error?.fieldErrors?.[`examples.${at}.answer`]?.[0]
    );
  };

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const kept = examples.flatMap((e, i) => (e.situation.trim() || e.answer.trim() ? [i] : []));
    setSent(kept);
    const input = {
      name: text("name"),
      whenToUse: text("whenToUse"),
      steps: text("steps"),
      dos: text("dos"),
      donts: text("donts"),
      notes: text("notes"),
      change: props.mode === "edit" ? text("change") : undefined,
      // Rows left empty are not examples.
      examples: kept.map((i) => examples[i]!),
    };
    setDone(undefined);
    startTransition(async () => {
      if (props.mode === "new") {
        const result = await createSkillAction(text("agent"), input);
        if (!result.ok) return setError(result.error);
        setError(undefined);
        router.push(`/ai/skills/${result.data.id}`);
        return;
      }
      const result = await updateSkillAction(props.skillId, input);
      if (!result.ok) return setError(result.error);
      setError(undefined);
      setDone(
        result.data.changed
          ? `Saved as version ${result.data.version}. Run the test again before the agent uses it on Do.`
          : "Nothing changed.",
      );
      router.refresh();
    });
  }

  const general =
    error && !(error.code === "VALIDATION" && error.fieldErrors) ? error.message : undefined;

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {props.mode === "new" && (
        <Field id="skill-agent" label="Agent" error={fieldError("agent")}>
          <NativeSelect id="skill-agent" name="agent" defaultValue={props.agent ?? "mehedi"}>
            {props.agents.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field
        id="skill-name"
        label="Skill name"
        hint="A short name, e.g. a polo shirt's costing check"
        error={fieldError("name")}
      >
        <Input id="skill-name" name="name" defaultValue={start.name} maxLength={80} />
      </Field>
      <Field
        id="skill-when"
        label="When to use it"
        hint="The work or question this skill is for"
        error={fieldError("whenToUse")}
      >
        <Textarea id="skill-when" name="whenToUse" defaultValue={start.whenToUse} rows={2} />
      </Field>
      <Field
        id="skill-steps"
        label="Steps"
        hint="One step a line, in order"
        error={fieldError("steps")}
      >
        <Textarea id="skill-steps" name="steps" defaultValue={start.steps} rows={6} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="skill-dos" label="Do's" error={fieldError("dos")}>
          <Textarea id="skill-dos" name="dos" defaultValue={start.dos ?? ""} rows={4} />
        </Field>
        <Field id="skill-donts" label="Don'ts" error={fieldError("donts")}>
          <Textarea id="skill-donts" name="donts" defaultValue={start.donts ?? ""} rows={4} />
        </Field>
      </div>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">Examples</legend>
        <p className="text-[0.8125rem] text-muted-foreground">
          A situation and the answer you expect. Each example is also a test question: the skill
          passes when the agent gets every one right.
        </p>
        {examples.map((e, i) => (
          <div key={i} className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Example {i + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setExamples((all) => all.filter((_, j) => j !== i))}
                aria-label={`Remove example ${i + 1}`}
              >
                <Trash2Icon aria-hidden />
              </Button>
            </div>
            <Textarea
              aria-label={`Situation of example ${i + 1}`}
              placeholder="Situation"
              value={e.situation}
              rows={2}
              onChange={(ev) =>
                setExamples((all) =>
                  all.map((x, j) => (j === i ? { ...x, situation: ev.target.value } : x)),
                )
              }
            />
            <Textarea
              aria-label={`Right answer of example ${i + 1}`}
              placeholder="Right answer"
              value={e.answer}
              rows={2}
              onChange={(ev) =>
                setExamples((all) =>
                  all.map((x, j) => (j === i ? { ...x, answer: ev.target.value } : x)),
                )
              }
            />
            {exampleError(i) && (
              <p className="text-[0.8125rem] text-destructive">{exampleError(i)}</p>
            )}
          </div>
        ))}
        {fieldError("examples") && (
          <p className="text-[0.8125rem] text-destructive">{fieldError("examples")}</p>
        )}
        {examples.length < MAX_EXAMPLES && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => setExamples((all) => [...all, { situation: "", answer: "" }])}
          >
            <PlusIcon aria-hidden />
            Add an example
          </Button>
        )}
      </fieldset>

      <Field
        id="skill-notes"
        label="Notes (knowledge)"
        hint="Facts the agent should know for this skill. PDFs and photos are added on the skill's page."
        error={fieldError("notes")}
      >
        <Textarea id="skill-notes" name="notes" defaultValue={start.notes ?? ""} rows={5} />
      </Field>
      {props.mode === "edit" && (
        <Field
          id="skill-change"
          label="What changed"
          hint="One line for the versions list"
          error={fieldError("change")}
        >
          <Input id="skill-change" name="change" maxLength={200} />
        </Field>
      )}

      {general && <FormAlert>{general}</FormAlert>}
      {done && <FormAlert tone="success">{done}</FormAlert>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          {props.mode === "new" ? "Teach the skill" : "Save as a new version"}
        </Button>
      </div>
    </form>
  );
}
