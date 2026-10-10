"use client";

import { LayoutTemplateIcon } from "lucide-react";
import { useState } from "react";

import { ChoiceList } from "@/components/parties/choice-list";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TemplateChoice } from "@/modules/reports/screens.service";
import { fillTemplateAction } from "@/server/actions/templates.actions";

import { FileReadyDialog, type ReadyFile } from "./file-ready";
import { TEMPLATE_RESULT_HINTS } from "./labels";

/**
 * Fills one of the company's own designs (Reports & documents › Templates) with
 * a quotation, proforma, invoice or challan. Shown only when the record's type
 * has active templates this person may fill; the file is kept with the printed
 * documents.
 */
export function UseTemplateButton({
  id,
  templates,
  what,
  label = "Template",
  className,
}: {
  /** The record to fill it with. */
  id: string;
  templates: TemplateChoice[];
  /** "Quotation Q-0012", for the window's heading. */
  what: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<ReadyFile>();
  if (templates.length === 0) return null;
  const only = templates.length === 1 ? templates[0] : undefined;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        onClick={() => setOpen(true)}
      >
        <LayoutTemplateIcon aria-hidden />
        {label}
      </Button>
      {open && (
        <FormDialog
          title={`${what} on your own design`}
          description={
            only
              ? `Fills "${only.name}" with this document. ${TEMPLATE_RESULT_HINTS[only.format] ?? ""}`
              : "Pick the design to fill with this document."
          }
          submitLabel="Make the file"
          pendingLabel="Making the file"
          errorTitle="We could not fill the template"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const templateId = only?.id ?? String(form.get("template") ?? "");
            const result = await fillTemplateAction(templateId, { id });
            if (!result.ok) return result.error;
            setOpen(false);
            setReady(result.data);
            return undefined;
          }}
        >
          {() =>
            !only && (
              <ChoiceList
                name="template"
                legend="Design"
                defaultValue={templates[0]!.id}
                options={templates.map((t) => ({
                  value: t.id,
                  label: t.isDefault ? `${t.name} (default)` : t.name,
                  hint: TEMPLATE_RESULT_HINTS[t.format],
                }))}
              />
            )
          }
        </FormDialog>
      )}
      {ready && <FileReadyDialog file={ready} eyebrow={what} onClose={() => setReady(undefined)} />}
    </>
  );
}
