"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { SIGN_METHOD_LABELS, TERMS_LIMITS } from "@/modules/hr/terms";
import type { PresentedTermsVersion, TermsScreen } from "@/modules/hr/terms.service";
import {
  discardTermsDraftAction,
  publishTermsAction,
  remakeTermsPdfAction,
  saveTermsDraftAction,
  startTermsDraftAction,
} from "@/server/actions/terms.actions";

import { FlagBadge } from "./badges";
import { hrHref } from "./labels";
import { useNotice } from "./use-notice";

type SectionRow = { key: number; title: string; body: string };

/** Opens a draft: the next version from the one in force, or the starter text. */
export function StartTermsDraft({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startTermsDraftAction();
            if (!result.ok) return setError(result.error);
            router.refresh();
          })
        }
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : (
          <PlusIcon aria-hidden />
        )}
        {label}
      </Button>
      {error && error.code !== "INTERNAL" && (
        <div className="mt-3 w-full">
          <FormAlert>{error.message}</FormAlert>
        </div>
      )}
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not start the draft"
          onClose={() => setError(undefined)}
        />
      )}
    </>
  );
}

/**
 * The draft of the next version: its title, opening note and sections, each
 * with a heading and text (paragraphs split by a blank line), moved, added and
 * removed freely. Saved as it is, then published once it reads right.
 */
export function TermsEditor({
  draft,
  first,
}: {
  draft: PresentedTermsVersion;
  /** Publishing the first version always asks everyone. */
  first: boolean;
}) {
  const router = useRouter();
  const nextKey = useRef(draft.sections.length);
  const [title, setTitle] = useState(draft.title);
  const [intro, setIntro] = useState(draft.intro ?? "");
  const [sections, setSections] = useState<SectionRow[]>(() =>
    draft.sections.map((s, key) => ({ key, ...s })),
  );
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<ActionError>();
  const [notice, setNotice] = useNotice();
  const [open, setOpen] = useState<"publish" | "discard" | null>(null);
  const [pending, startTransition] = useTransition();

  const touch = () => {
    setDirty(true);
    setNotice(undefined);
  };
  const editSection = (key: number, patch: Partial<SectionRow>) => {
    touch();
    setSections((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const moveSection = (index: number, by: number) => {
    touch();
    setSections((rows) => {
      const copy = [...rows];
      const [row] = copy.splice(index, 1);
      copy.splice(index + by, 0, row!);
      return copy;
    });
  };

  /** The draft as the server takes it, after the checks it would make. */
  function checked() {
    const found: Record<string, string> = {};
    if (!title.trim()) found.title = "Give the terms a title.";
    if (sections.length === 0) found.sections = "Add at least one section.";
    sections.forEach((s, i) => {
      if (!s.title.trim()) found[`sections.${i}.title`] = "Give the section a heading.";
      if (!s.body.trim()) found[`sections.${i}.body`] = "Write the section's text.";
    });
    setProblems(found);
    return Object.keys(found).length === 0
      ? {
          title,
          intro: intro.trim() ? intro : null,
          sections: sections.map(({ title: t, body }) => ({ title: t, body })),
        }
      : null;
  }

  async function save(): Promise<ActionError | undefined> {
    const input = checked();
    if (!input) {
      return { code: "VALIDATION", message: "Please check the highlighted fields." };
    }
    const result = await saveTermsDraftAction(input);
    if (!result.ok) {
      if (result.error.fieldErrors) {
        setProblems(
          Object.fromEntries(
            Object.entries(result.error.fieldErrors).map(([k, v]) => [k, v[0] ?? ""]),
          ),
        );
      }
      return result.error;
    }
    setDirty(false);
    return undefined;
  }

  const problem = (key: string) => problems[key];

  return (
    <div className="mt-4 grid gap-6">
      <Field id="terms-title" label="Title" error={problem("title")}>
        <Input
          id="terms-title"
          value={title}
          maxLength={TERMS_LIMITS.title}
          onChange={(e) => {
            touch();
            setTitle(e.target.value);
          }}
          aria-invalid={Boolean(problem("title"))}
        />
      </Field>
      <Field
        id="terms-intro"
        label="Opening note (optional)"
        hint="Shown above the sections. Leave a blank line between paragraphs."
        error={problem("intro")}
      >
        <Textarea
          id="terms-intro"
          rows={4}
          value={intro}
          maxLength={TERMS_LIMITS.intro}
          onChange={(e) => {
            touch();
            setIntro(e.target.value);
          }}
        />
      </Field>

      <ol className="grid gap-5" aria-label="Sections">
        {sections.map((s, i) => (
          <li key={s.key} className="grid gap-4 rounded-md border p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="eyebrow">Section {i + 1}</span>
              <span className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 md:size-9"
                  aria-label={`Move section ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => moveSection(i, -1)}
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 md:size-9"
                  aria-label={`Move section ${i + 1} down`}
                  disabled={i === sections.length - 1}
                  onClick={() => moveSection(i, 1)}
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 text-muted-foreground hover:text-destructive md:size-9"
                  aria-label={`Remove section ${i + 1}`}
                  disabled={sections.length === 1}
                  onClick={() => {
                    touch();
                    setSections((rows) => rows.filter((r) => r.key !== s.key));
                  }}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </span>
            </div>
            <Field
              id={`section-${s.key}-title`}
              label="Heading"
              error={problem(`sections.${i}.title`)}
            >
              <Input
                id={`section-${s.key}-title`}
                value={s.title}
                maxLength={TERMS_LIMITS.sectionTitle}
                onChange={(e) => editSection(s.key, { title: e.target.value })}
                aria-invalid={Boolean(problem(`sections.${i}.title`))}
              />
            </Field>
            <Field id={`section-${s.key}-body`} label="Text" error={problem(`sections.${i}.body`)}>
              <Textarea
                id={`section-${s.key}-body`}
                rows={8}
                value={s.body}
                maxLength={TERMS_LIMITS.sectionBody}
                onChange={(e) => editSection(s.key, { body: e.target.value })}
                aria-invalid={Boolean(problem(`sections.${i}.body`))}
              />
            </Field>
          </li>
        ))}
      </ol>
      {problem("sections") && <FormAlert>{problem("sections")}</FormAlert>}
      {sections.length < TERMS_LIMITS.sections && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-start sm:w-auto"
          onClick={() => {
            touch();
            setSections((rows) => [...rows, { key: nextKey.current++, title: "", body: "" }]);
          }}
        >
          <PlusIcon aria-hidden />
          Add a section
        </Button>
      )}

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      <div className="flex flex-col gap-2 border-t pt-5 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(undefined);
              const failed = await save();
              if (failed) return setError(failed);
              setNotice("The draft was saved.");
              router.refresh();
            })
          }
        >
          {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
          Save the draft
        </Button>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={pending}
          onClick={() => {
            setError(undefined);
            if (checked()) setOpen("publish");
          }}
        >
          <SendIcon aria-hidden />
          Publish
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground sm:ml-auto sm:w-auto"
          disabled={pending}
          onClick={() => setOpen("discard")}
        >
          <Trash2Icon aria-hidden />
          Discard the draft
        </Button>
        {dirty && (
          <p className="text-[0.8125rem] text-muted-foreground sm:w-full" role="status">
            Changes not saved yet.
          </p>
        )}
      </div>

      {open === "publish" && (
        <FormDialog
          title={first ? "Publish the terms?" : "Publish the new version?"}
          description={
            first
              ? "Everyone with a login reads these terms and agrees before they use the app again. They are told in the app. A published version cannot be changed; a later change becomes a new version."
              : "A published version cannot be changed. Choose who must read and agree to this one."
          }
          submitLabel="Publish"
          pendingLabel="Publishing"
          errorTitle="We could not publish the terms"
          onClose={() => setOpen(null)}
          onSubmit={async (values) => {
            const failed = await save();
            if (failed) return failed;
            const result = await publishTermsAction({
              askEveryone: first || values.get("askEveryone") === "on",
            });
            if (!result.ok) return result.error;
            setOpen(null);
            router.refresh();
          }}
        >
          {() =>
            first ? null : (
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="askEveryone"
                  defaultChecked
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">Everyone agrees again</span>
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    Untick for small wording fixes: then only staff who have never agreed are asked.
                  </span>
                </span>
              </label>
            )
          }
        </FormDialog>
      )}
      {open === "discard" && (
        <FormDialog
          title="Discard the draft?"
          description="The draft is thrown away. Published versions stay as they are."
          submitLabel="Discard"
          pendingLabel="Discarding"
          destructive
          errorTitle="We could not discard the draft"
          onClose={() => setOpen(null)}
          onSubmit={async () => {
            const result = await discardTermsDraftAction();
            if (!result.ok) return result.error;
            setOpen(null);
            router.refresh();
          }}
        >
          {() => null}
        </FormDialog>
      )}
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the draft"
          onClose={() => setError(undefined)}
        />
      )}
    </div>
  );
}

const STATE_WORDS = {
  AGREED: "Agreed",
  TO_AGREE: "To agree",
  NO_LOGIN: "No login",
  NONE: "",
} as const;

/** Where each current employee stands, with their signed copy. */
export function TermsStaffList({
  staff,
  canEdit,
}: {
  staff: TermsScreen["staff"];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ActionError>();

  if (staff.rows.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">No current employees yet.</p>;
  }
  return (
    <div className="mt-4 grid gap-4">
      {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      <ul className="grid divide-y" aria-label="Staff and the terms">
        {staff.rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1">
              <Link
                href={hrHref.employee(r.id)}
                className="block text-sm font-medium break-words text-primary underline-offset-4 hover:underline"
              >
                {r.name}
              </Link>
              <span className="block text-[0.8125rem] text-muted-foreground">
                {[r.code, r.designation].filter(Boolean).join(" · ")}
              </span>
              {r.last && (
                <span className="mt-1 block text-[0.8125rem] text-muted-foreground">
                  Version {r.last.version}, {formatDay(r.last.signedOn)} ·{" "}
                  {SIGN_METHOD_LABELS[r.last.method]}
                </span>
              )}
              {r.last?.pdf === "READY" && r.last.fileId && (
                <a
                  href={hrHref.file(r.last.fileId)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-[0.8125rem] text-primary underline-offset-4 hover:underline"
                >
                  <FileTextIcon className="size-3.5" aria-hidden />
                  Signed copy
                </a>
              )}
              {r.last?.pdf === "MAKING" && (
                <span className="mt-1 block text-[0.8125rem] text-muted-foreground">
                  Making the signed copy…
                </span>
              )}
              {r.last?.pdf === "FAILED" && (
                <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-destructive">
                  The signed copy could not be made.
                  {canEdit && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0"
                      disabled={pending}
                      onClick={() => {
                        setBusy(r.last!.id);
                        startTransition(async () => {
                          const result = await remakeTermsPdfAction(r.last!.id);
                          setBusy(null);
                          if (!result.ok) return setError(result.error);
                          router.refresh();
                        });
                      }}
                    >
                      {busy === r.last.id ? (
                        <LoaderCircleIcon className="animate-spin" aria-hidden />
                      ) : (
                        <RefreshCwIcon aria-hidden />
                      )}
                      Make it again
                    </Button>
                  )}
                </span>
              )}
            </span>
            {r.state !== "NONE" && (
              <FlagBadge
                tone={r.state === "AGREED" ? "done" : r.state === "TO_AGREE" ? "warn" : "plain"}
              >
                {STATE_WORDS[r.state]}
              </FlagBadge>
            )}
          </li>
        ))}
      </ul>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not ask for the signed copy"
          onClose={() => setError(undefined)}
        />
      )}
    </div>
  );
}
