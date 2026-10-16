"use client";

import { ExternalLinkIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { TechPackScreen } from "@/modules/production/tech-pack-screen.service";
import { addReferenceAction, removeReferenceAction } from "@/server/actions/tech-pack.actions";

/*
 * Saved references: photos, links and notes saved to the style by hand or from
 * the phone's Share button (Save to Tech Pack). The AI reads them when it
 * drafts. They stay until someone removes them.
 */

export function ReferencesPanel({ screen }: { screen: TechPackScreen }) {
  const { techPack, references, can } = screen;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <Panel
      title="Saved references"
      id="tech-pack-references-heading"
      action={
        can.edit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <ImagePlusIcon aria-hidden />
            Save a reference
          </Button>
        ) : null
      }
    >
      {references.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing saved yet. Save the buyer&apos;s photos, a sample picture or a web link here, or
          share it from your phone with{" "}
          <Link href="/production/save" className="text-primary underline-offset-4 hover:underline">
            Save to Tech Pack
          </Link>
          . The AI reads them when it drafts.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {references.map((r) => {
            const picture = r.file?.mimeType.startsWith("image/");
            return (
              <li key={r.id} className="flex gap-3 rounded-md border p-3">
                {r.file && picture ? (
                  <a
                    href={productionHref.file(r.file.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload */}
                    <img
                      src={productionHref.file(r.file.id)}
                      alt={r.note ?? r.file.fileName}
                      className="size-20 rounded object-cover"
                    />
                  </a>
                ) : null}
                <div className="min-w-0 flex-1 text-sm">
                  {r.note && <p className="break-words">{r.note}</p>}
                  {r.file && !picture && (
                    <a
                      className="break-all text-primary underline-offset-4 hover:underline"
                      href={productionHref.file(r.file.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.file.fileName}
                    </a>
                  )}
                  {r.link && (
                    <a
                      className="inline-flex items-center gap-1 break-all text-primary underline-offset-4 hover:underline"
                      href={r.link}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
                      {r.link.replace(/^https?:\/\//, "").slice(0, 60)}
                    </a>
                  )}
                  <p className="mt-1 text-[0.75rem] text-muted-foreground">
                    {formatDay(r.day)}
                    {r.savedBy ? ` · ${r.savedBy}` : ""}
                  </p>
                </div>
                {can.edit && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove the reference"
                    onClick={() => setRemoving(r.id)}
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <FormDialog
          title="Save a reference"
          description="A photo, a link or both, with a short note. The AI reads it when it drafts."
          submitLabel="Save"
          pendingLabel="Saving"
          errorTitle="We could not save the reference"
          onClose={() => setAdding(false)}
          onSubmit={async (form) => {
            const result = await addReferenceAction(techPack.id, form);
            if (!result.ok) return result.error;
            setAdding(false);
          }}
        >
          {(fieldError) => (
            <div className="grid gap-4">
              <Field
                id="ref-file"
                label="Photo or PDF"
                hint="JPG, PNG, WebP or PDF, up to 10 MB."
                error={fieldError("file")}
              >
                <Input
                  id="ref-file"
                  name="file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                />
              </Field>
              <Field id="ref-link" label="Link" error={fieldError("link")}>
                <Input
                  id="ref-link"
                  name="link"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                />
              </Field>
              <Field id="ref-note" label="Note" error={fieldError("note")}>
                <Textarea id="ref-note" name="note" rows={2} />
              </Field>
            </div>
          )}
        </FormDialog>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove the reference?"
          description="It is taken off this tech pack. The file stays in the record of uploads."
          confirmLabel="Remove"
          pendingLabel="Removing"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const result = await removeReferenceAction(techPack.id, removing);
            if (!result.ok) return result.error;
            setRemoving(null);
          }}
        />
      )}
    </Panel>
  );
}
