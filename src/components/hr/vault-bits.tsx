"use client";

import type { EmployeeDocumentKind } from "@prisma/client";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { compressImage, fileSize } from "@/lib/compress-image";
import { formatDay } from "@/lib/display";
import type { ActionResult } from "@/lib/result";
import {
  DOCUMENT_KIND_LABELS,
  VAULT_ITEM_LABELS,
  VAULT_ITEMS,
  type VaultItem,
} from "@/modules/hr/vault";

import { hrHref } from "./labels";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Scans of an ID card stay readable at this size. */
const SCAN_TARGET_BYTES = 350 * 1024;
const SCAN_MAX_SIDE = 2000;
/** A face photo: sharp on a profile and light enough for the employee directory. */
const PHOTO_TARGET_BYTES = 80 * 1024;
const PHOTO_MAX_SIDE = 800;

/**
 * The four things a complete record holds, each ticked or marked missing:
 * "3 of 4 filled".
 */
export function VaultChecklist({ gaps }: { gaps: readonly VaultItem[] }) {
  const missing = new Set(gaps);
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2" aria-label="What the record holds">
      {VAULT_ITEMS.map((item) => {
        const has = !missing.has(item);
        return (
          <li key={item} className="flex items-start gap-2 text-sm">
            {has ? (
              <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            )}
            <span>
              {VAULT_ITEM_LABELS[item]}
              <span className="sr-only">{has ? ": filled" : ": missing"}</span>
              {!has && <span className="block text-[0.8125rem] text-destructive">Missing</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type PaperRow = {
  id: string;
  kind: EmployeeDocumentKind;
  title: string | null;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedBy: { id: string; name: string } | null;
  /** "2026-10-11", in company time. */
  addedOn: string;
  /** Shown with a Remove button. */
  canRemove: boolean;
};

/**
 * The papers kept in a vault, newest first, each opening in a new tab; with
 * "Add a paper" (photo or PDF, a photo made smaller first) and Remove.
 */
export function VaultPapers({
  papers,
  kinds,
  canAdd,
  add,
  remove,
  empty,
  onDone,
}: {
  papers: readonly PaperRow[];
  /** The kinds offered when adding. */
  kinds: readonly EmployeeDocumentKind[];
  canAdd: boolean;
  add: (form: FormData) => Promise<ActionResult<{ id: string; fileName: string }>>;
  remove: (id: string) => Promise<ActionResult<{ id: string }>>;
  /** What to say when there are none. */
  empty: string;
  /** A message once something was added or removed. */
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState<"add" | { remove: PaperRow } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const close = () => {
    setOpen(null);
    setFile(null);
  };

  return (
    <div className="grid gap-4">
      {papers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid divide-y" aria-label="Papers">
          {papers.map((p) => {
            const Icon = p.mimeType.startsWith("image/") ? ImageIcon : FileTextIcon;
            return (
              <li key={p.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <a
                    href={hrHref.file(p.fileId)}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {p.title || DOCUMENT_KIND_LABELS[p.kind]}
                  </a>
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {p.title ? `${DOCUMENT_KIND_LABELS[p.kind]} · ` : ""}
                    {formatDay(p.addedOn)}
                    {p.addedBy ? ` · ${p.addedBy.name}` : ""} · {fileSize(p.sizeBytes)}
                  </span>
                </span>
                {p.canRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-my-1 size-11 shrink-0 text-muted-foreground hover:text-destructive md:size-9"
                    aria-label={`Remove ${p.title || DOCUMENT_KIND_LABELS[p.kind]}`}
                    onClick={() => setOpen({ remove: p })}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-self-start sm:w-auto"
          onClick={() => setOpen("add")}
        >
          <PaperclipIcon aria-hidden />
          Add a paper
        </Button>
      )}

      {open === "add" && (
        <FormDialog
          title="Add a paper"
          description="A photo or a PDF, up to 10 MB. Photos are made smaller before they are sent, and stay readable. Only HR and the employee can open it."
          submitLabel="Add the paper"
          pendingLabel="Adding"
          errorTitle="We could not add the paper"
          onClose={close}
          onSubmit={async (values) => {
            if (!file) return problem({ file: "Choose the photo or PDF." });
            if (file.size > MAX_FILE_BYTES && !file.type.startsWith("image/")) {
              return problem({ file: "Files can be up to 10 MB." });
            }
            let upload = file;
            const kind = textOf(values, "kind");
            if (file.type.startsWith("image/")) {
              try {
                upload =
                  kind === "PHOTO"
                    ? await compressImage(file, PHOTO_TARGET_BYTES, { maxSide: PHOTO_MAX_SIDE })
                    : await compressImage(file, SCAN_TARGET_BYTES, { maxSide: SCAN_MAX_SIDE });
              } catch (error) {
                return problem({ file: (error as Error).message });
              }
            }
            const form = new FormData();
            form.set("file", upload);
            form.set("kind", kind);
            const title = textOf(values, "title");
            if (title) form.set("title", title);
            const result = await add(form);
            if (!result.ok) return result.error;
            onDone(`${title || result.data.fileName} was added.`);
            close();
          }}
        >
          {(fieldError) => (
            <>
              <Field id="paper-kind" label="What it is" error={fieldError("kind")}>
                <NativeSelect
                  id="paper-kind"
                  name="kind"
                  defaultValue={kinds[0]}
                  containerClassName="sm:w-full"
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {DOCUMENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                id="paper-title"
                label="Name (optional)"
                hint="Like: SSC certificate, NID front and back."
                error={fieldError("title")}
              >
                <Input
                  id="paper-title"
                  name="title"
                  maxLength={120}
                  autoComplete="off"
                  aria-describedby="paper-title-hint"
                />
              </Field>
              <Field
                id="paper-file"
                label="Photo or PDF"
                hint={
                  file ? `${file.name}, ${fileSize(file.size)}` : "Take a photo or choose a file."
                }
                error={fieldError("file")}
              >
                <Input
                  id="paper-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="h-auto py-1.5 file:mr-3"
                  aria-invalid={Boolean(fieldError("file"))}
                  aria-describedby={fieldError("file") ? "paper-file-error" : "paper-file-hint"}
                />
              </Field>
            </>
          )}
        </FormDialog>
      )}

      {open !== null && open !== "add" && (
        <FormDialog
          title="Remove this paper?"
          description={`${open.remove.title || DOCUMENT_KIND_LABELS[open.remove.kind]} and its file are removed for good. The activity log keeps a note that it was removed.`}
          submitLabel="Remove"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the paper"
          onClose={close}
          onSubmit={async () => {
            const result = await remove(open.remove.id);
            if (!result.ok) return result.error;
            onDone(`${open.remove.title || DOCUMENT_KIND_LABELS[open.remove.kind]} was removed.`);
            close();
          }}
        >
          {() => null}
        </FormDialog>
      )}
    </div>
  );
}
