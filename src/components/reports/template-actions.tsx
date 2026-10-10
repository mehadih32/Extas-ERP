"use client";

import {
  CircleCheckIcon,
  CodeIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  PencilIcon,
  PowerIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { TemplateScreen } from "@/modules/reports/screens.service";
import {
  deleteTemplateAction,
  fillTemplateAction,
  replaceTemplateFileAction,
  updateTemplateAction,
} from "@/server/actions/templates.actions";

import { FileReadyDialog, type ReadyFile } from "./file-ready";
import { reportsHref, TEMPLATE_FORMAT_LABELS } from "./labels";

type Open = "rename" | "replace" | "html" | "delete" | "off" | null;

const MAX_FILE_BYTES = 10 * 1024 * 1024 - 64 * 1024;

const ACCEPT: Record<string, string> = {
  WORD: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PDF: ".pdf,application/pdf",
  IMAGE: ".png,.jpg,.jpeg,image/png,image/jpeg",
};

/**
 * What can be done with a template: try it on the newest record of its kind,
 * replace its file (or edit its HTML), download it, rename it, offer it first,
 * switch it off or on, and delete it.
 */
export function TemplateActions({ screen }: { screen: TemplateScreen }) {
  const router = useRouter();
  const { template: t, sample, html } = screen;
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<ActionError>();
  const [ready, setReady] = useState<ReadyFile>();
  const [pending, startTransition] = useTransition();
  const close = () => setOpen(null);
  const file = reportsHref.templateFile(t.id);
  const overlay = t.format === "PDF" || t.format === "IMAGE";

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);

  function update(input: { isDefault?: boolean; isActive?: boolean }, done: string) {
    startTransition(async () => {
      const result = await updateTemplateAction(t.id, input);
      if (!result.ok) setError(result.error);
      else setNotice(done);
    });
  }

  function tryIt() {
    if (!sample) return;
    startTransition(async () => {
      const result = await fillTemplateAction(t.id, sample.id ? { id: sample.id } : {});
      if (!result.ok) setError(result.error);
      else setReady(result.data);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {sample && t.isActive && (
          <Button type="button" className="w-full sm:w-auto" disabled={pending} onClick={tryIt}>
            <FlaskConicalIcon aria-hidden />
            Try it on {sample.label}
          </Button>
        )}
        <div className="flex gap-2">
          {t.format === "HTML" ? (
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpen("html")}
            >
              <CodeIcon aria-hidden />
              Edit the HTML
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpen("replace")}
            >
              <UploadIcon aria-hidden />
              Replace the file
            </Button>
          )}
          <Button asChild variant="outline" className="flex-1 sm:flex-none">
            <a href={file} download>
              <DownloadIcon aria-hidden />
              Download
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={`More for ${t.name}`}>
                <EllipsisVerticalIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {overlay && (
                <DropdownMenuItem asChild>
                  <a href={`${file}?inline=1`} target="_blank" rel="noopener">
                    <ExternalLinkIcon aria-hidden />
                    Open the {t.format === "PDF" ? "PDF" : "picture"}
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setOpen("rename")}>
                <PencilIcon aria-hidden />
                Rename
              </DropdownMenuItem>
              {t.isDefault ? (
                <DropdownMenuItem
                  onSelect={() => update({ isDefault: false }, "It is no longer offered first.")}
                >
                  <StarOffIcon aria-hidden />
                  Stop offering it first
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() =>
                    update(
                      { isDefault: true },
                      `It is now offered first for ${t.documentLabel.toLowerCase()}s.`,
                    )
                  }
                >
                  <StarIcon aria-hidden />
                  Offer it first
                </DropdownMenuItem>
              )}
              {t.isActive ? (
                <DropdownMenuItem onSelect={() => setOpen("off")}>
                  <PowerIcon aria-hidden />
                  Switch off
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() =>
                    update({ isActive: true }, "Switched on: people can fill it again.")
                  }
                >
                  <CircleCheckIcon aria-hidden />
                  Switch on
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete")}>
                <Trash2Icon aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!t.isActive && (
        <FormAlert tone="note">
          Switched off: nobody can fill it until it is switched on again.
        </FormAlert>
      )}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {open === "rename" && (
        <FormDialog
          title="Rename the template"
          description="People pick it by this name when they fill a document."
          submitLabel="Save the name"
          pendingLabel="Saving"
          errorTitle="We could not rename the template"
          onClose={close}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            if (name.length < 2) return problem({ name: "Give it a name." });
            const result = await updateTemplateAction(t.id, { name });
            if (!result.ok) return result.error;
            close();
            setNotice("Renamed.");
            return undefined;
          }}
        >
          {(fieldError) => (
            <Field id="rename-name" label="Name" error={fieldError("name")}>
              <Input
                id="rename-name"
                name="name"
                defaultValue={t.name}
                required
                minLength={2}
                maxLength={120}
                autoComplete="off"
                aria-invalid={Boolean(fieldError("name"))}
                aria-describedby={fieldError("name") ? "rename-name-error" : undefined}
              />
            </Field>
          )}
        </FormDialog>
      )}

      {open === "replace" && (
        <FormDialog
          title="Replace the file"
          description={
            overlay
              ? `Upload the new version (a ${TEMPLATE_FORMAT_LABELS[t.format]} file). Placed tags stay where they are; tags on pages it no longer has are removed.`
              : "Upload the new version (a Word file). Tags still in it keep what they print; new tags are matched to data where their name is known."
          }
          submitLabel="Upload"
          pendingLabel="Uploading"
          errorTitle="We could not replace the file"
          onClose={close}
          onSubmit={async (form) => {
            const upload = form.get("file");
            if (!(upload instanceof File) || upload.size === 0) {
              return problem({ file: "Choose the file." });
            }
            if (upload.size > MAX_FILE_BYTES) return problem({ file: "Files can be up to 10 MB." });
            const result = await replaceTemplateFileAction(t.id, form);
            if (!result.ok) return result.error;
            close();
            setNotice("The file is replaced. Check its tags below.");
            return undefined;
          }}
        >
          {(fieldError) => (
            <Field
              id="replace-file"
              label="New file"
              hint="Up to 10 MB."
              error={fieldError("file")}
            >
              <Input
                id="replace-file"
                name="file"
                type="file"
                accept={ACCEPT[t.format]}
                className="h-auto py-1.5 file:mr-3"
                aria-invalid={Boolean(fieldError("file"))}
                aria-describedby={fieldError("file") ? "replace-file-error" : "replace-file-hint"}
              />
            </Field>
          )}
        </FormDialog>
      )}

      {open === "html" && (
        <FormDialog
          className="sm:max-w-2xl"
          title="Edit the HTML"
          description="Tags still in the page keep what they print; new tags are matched to data where their name is known."
          submitLabel="Save the page"
          pendingLabel="Saving"
          errorTitle="We could not save the page"
          onClose={close}
          onSubmit={async (form) => {
            const text = String(form.get("html") ?? "");
            if (!text.trim()) return problem({ html: "Write the page." });
            const result = await updateTemplateAction(t.id, { html: text });
            if (!result.ok) return result.error;
            close();
            setNotice("The page is saved. Check its tags below.");
            return undefined;
          }}
        >
          {(fieldError) => (
            <Field
              id="edit-html"
              label="The page"
              hint="Scripts, forms and frames are not allowed. A table row with item tags repeats for every line."
              error={fieldError("html")}
            >
              <Textarea
                id="edit-html"
                name="html"
                defaultValue={html ?? ""}
                rows={16}
                spellCheck={false}
                className="font-mono text-[0.8125rem] md:text-[0.8125rem]"
                aria-invalid={Boolean(fieldError("html"))}
                aria-describedby={fieldError("html") ? "edit-html-error" : "edit-html-hint"}
              />
            </Field>
          )}
        </FormDialog>
      )}

      {open === "off" && (
        <ConfirmDialog
          title={`Switch off "${t.name}"?`}
          description="It stays here with its tags, but nobody can fill it until it is switched on again. Documents already filled from it are kept."
          confirmLabel="Switch off"
          pendingLabel="Switching off"
          errorTitle="We could not switch it off"
          onClose={close}
          onConfirm={async () => {
            const result = await updateTemplateAction(t.id, { isActive: false });
            if (!result.ok) return result.error;
            close();
            setNotice("Switched off.");
            return undefined;
          }}
        />
      )}

      {open === "delete" && (
        <ConfirmDialog
          title={`Delete "${t.name}"?`}
          description="The template and its file are deleted. Documents already filled from it are kept with the printed documents."
          confirmLabel="Delete the template"
          pendingLabel="Deleting"
          destructive
          errorTitle="We could not delete the template"
          onClose={close}
          onConfirm={async () => {
            const result = await deleteTemplateAction(t.id);
            if (!result.ok) return result.error;
            router.push(reportsHref.templates);
            return undefined;
          }}
        />
      )}

      {ready && (
        <FileReadyDialog
          file={ready}
          eyebrow={`${t.name}, tried`}
          onClose={() => setReady(undefined)}
        />
      )}
      <ActionErrorDialog
        error={error}
        title="That did not go through"
        onClose={() => setError(undefined)}
      />
    </div>
  );
}
