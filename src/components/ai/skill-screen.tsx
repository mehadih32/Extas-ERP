"use client";

import {
  CheckIcon,
  FileTextIcon,
  FlaskConicalIcon,
  PowerIcon,
  PowerOffIcon,
  Undo2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { SkillForm } from "@/components/ai/skill-form";
import { SKILL_TONES } from "@/components/ai/skills-list";
import { useWhen } from "@/components/ai/when";
import { FormAlert } from "@/components/forms/field";
import { StatusBadge } from "@/components/sales/badges";
import { Panel } from "@/components/sales/detail-bits";
import { Button } from "@/components/ui/button";
import type { SkillScreen as Skill } from "@/modules/ai/skills.service";
import {
  addSkillFileAction,
  readSkillFileAction,
  removeSkillFileAction,
  setSkillOnAction,
  startSkillTestAction,
  undoSkillAction,
} from "@/server/actions/ai.actions";

/*
 * One skill: what it says, its test (each example as a question, the agent's
 * answer and whether it was right), its knowledge files, and its versions with
 * Undo. The owner changes it, adds files, runs the test and switches it on or
 * off; everyone who sees the AI Center reads it.
 */

type Message = { tone: "success" | "error"; text: string };

/** How often the page looks again while a test runs. */
const WATCH_MS = 4000;

function Block({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <div>
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="mt-1 text-sm whitespace-pre-line">{text}</p>
    </div>
  );
}

export function SkillScreen({ skill: s }: { skill: Skill }) {
  const router = useRouter();
  const when = useWhen({ year: true });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>();
  const fileInput = useRef<HTMLInputElement>(null);
  const v = s.newest;
  const running = v.test.status === "RUNNING";
  const manage = s.can.manage;

  // The test runs in the background: look again until it is done.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), WATCH_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    done: string,
  ) =>
    startTransition(async () => {
      const result = await work();
      setMessage(
        result.ok ? { tone: "success", text: done } : { tone: "error", text: result.error.message },
      );
      if (result.ok) router.refresh();
    });

  const upload = () => {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setMessage({ tone: "error", text: "Choose a PDF or a photo to add." });
      return;
    }
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const result = await addSkillFileAction(s.id, form);
      if (fileInput.current) fileInput.current.value = "";
      setMessage(
        result.ok
          ? {
              tone: "success",
              text: result.data.read
                ? `Added and read by the AI: version ${result.data.version}. Run the test again.`
                : `Added as version ${result.data.version}. The AI reads it with "Read" once AI is on.`,
            }
          : { tone: "error", text: result.error.message },
      );
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="grid gap-6">
      {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}

      <section
        aria-labelledby="skill-heading"
        className="grid gap-4 rounded-lg border bg-card p-5 sm:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="skill-heading" className="font-serif text-xl text-primary">
                {v.name}
              </h2>
              <StatusBadge tone={running ? "open" : SKILL_TONES[v.test.standing]}>
                {v.test.text}
              </StatusBadge>
              {!s.on && <StatusBadge tone="closed">Switched off</StatusBadge>}
            </div>
            <p className="text-sm text-muted-foreground">
              A skill of{" "}
              <Link href="/ai/agents" className="underline underline-offset-4">
                {s.agentName}
              </Link>{" "}
              · version {v.version} · {v.examples.length} examples · {v.files.length} files ·{" "}
              <Link href="/ai/skills" className="underline underline-offset-4">
                Skills
              </Link>
            </p>
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || running || v.examples.length === 0}
                onClick={() =>
                  run(
                    () => startSkillTestAction(s.id),
                    "The test is running: each example goes to the agent, then the answers are marked.",
                  )
                }
              >
                <FlaskConicalIcon aria-hidden />
                {running ? "Testing now" : "Run the test"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setSkillOnAction(s.id, !s.on),
                    s.on ? "Switched off: the agent does not use it." : "Switched on.",
                  )
                }
              >
                {s.on ? <PowerOffIcon aria-hidden /> : <PowerIcon aria-hidden />}
                {s.on ? "Switch off" : "Switch on"}
              </Button>
            </div>
          )}
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">
          The agent uses the newest version while the skill is on. Its work on Do waits (asks you
          first) until this version passes the test.
        </p>
      </section>

      <Panel title="Test" id="skill-test-heading">
        {running ? (
          <p className="mt-2 text-sm">Testing now. This page updates by itself.</p>
        ) : v.test.status === null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {v.examples.length === 0
              ? "Add an example to test it: each example is a test question."
              : "Not tested yet. “Run the test” asks the agent each example and marks the answers (it costs a little)."}
          </p>
        ) : (
          <div className="mt-2 grid gap-3 text-sm">
            <p>
              {v.test.text}
              {v.test.at ? ` · ${when(v.test.at)}` : ""}
              {v.test.model ? ` · ${v.test.model}` : ""}
            </p>
            {v.test.error && <FormAlert>{v.test.error}</FormAlert>}
            {v.test.lines.length > 0 && (
              <ol className="grid gap-3">
                {v.test.lines.map((l, i) => (
                  <li key={i} className="grid gap-1 rounded-md border p-3">
                    <span className="flex items-center gap-2 font-medium">
                      {l.right ? (
                        <CheckIcon aria-hidden className="size-4 text-primary" />
                      ) : (
                        <XIcon aria-hidden className="size-4 text-destructive" />
                      )}
                      Example {i + 1}: {l.right ? "right" : "not right"}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Situation: </span>
                      {l.situation}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Right answer: </span>
                      {l.expected}
                    </span>
                    <span className="whitespace-pre-line">
                      <span className="text-muted-foreground">The agent&apos;s answer: </span>
                      {l.answer}
                    </span>
                    {l.why && <span className="text-muted-foreground">{l.why}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Panel>

      <Panel title={manage ? "Change the skill" : "The skill"} id="skill-content-heading">
        <div className="mt-4">
          {manage ? (
            <SkillForm
              key={v.version}
              mode="edit"
              skillId={s.id}
              initial={{
                name: v.name,
                whenToUse: v.whenToUse,
                steps: v.steps,
                dos: v.dos,
                donts: v.donts,
                examples: v.examples,
                notes: v.notes,
              }}
            />
          ) : (
            <div className="grid gap-4">
              <Block title="When to use it" text={v.whenToUse} />
              <Block title="Steps" text={v.steps} />
              <Block title="Do's" text={v.dos} />
              <Block title="Don'ts" text={v.donts} />
              {v.examples.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium">Examples</h4>
                  <ol className="mt-1 grid list-decimal gap-2 pl-5 text-sm">
                    {v.examples.map((e, i) => (
                      <li key={i}>
                        {e.situation}
                        <br />
                        <span className="text-muted-foreground">Right answer: </span>
                        {e.answer}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <Block title="Notes (knowledge)" text={v.notes} />
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Knowledge files" id="skill-files-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          PDFs or photos of pages. The AI reads each one into text once, and the agent knows that
          text when it uses the skill.
        </p>
        {v.files.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No files yet.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {v.files.map((f) => (
              <li key={f.fileId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <a
                    href={`/api/files/${f.fileId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate underline underline-offset-4"
                  >
                    {f.name}
                  </a>
                  <span className="text-muted-foreground">
                    {f.text === null
                      ? "Not read yet"
                      : `Read: ${f.text.length.toLocaleString("en")} characters`}
                  </span>
                </span>
                {manage && (
                  <span className="flex gap-2">
                    {f.text === null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => readSkillFileAction(s.id, f.fileId),
                            `The AI read ${f.name}. Run the test again.`,
                          )
                        }
                      >
                        Read
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => removeSkillFileAction(s.id, f.fileId),
                          `Took out ${f.name} (a new version; Undo brings it back).`,
                        )
                      }
                    >
                      Take out
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              aria-label="PDF or photo"
              className="max-w-full text-sm"
            />
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={upload}>
              <UploadIcon aria-hidden />
              Add the file
            </Button>
          </div>
        )}
      </Panel>

      <Panel title="Versions" id="skill-versions-heading">
        <ul className="mt-3 divide-y text-sm">
          {s.versions.map((x) => (
            <li
              key={x.version}
              className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="grid gap-0.5">
                <span className="font-medium">
                  Version {x.version}
                  {x.version === v.version ? " (in use)" : ""}
                  {x.change ? `: ${x.change}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {when(x.at)}
                  {x.by ? ` · ${x.by}` : ""} · {x.test.text}
                </span>
              </span>
              {manage && x.version !== v.version && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => undoSkillAction(s.id, x.version),
                      `Version ${x.version} is back as the newest.`,
                    )
                  }
                >
                  <Undo2Icon aria-hidden />
                  Undo to this version
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
