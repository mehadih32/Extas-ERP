"use client";

import { MailIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { ChoiceList } from "@/components/parties/choice-list";
import { FormDialog } from "@/components/sales/dialogs";
import { SearchList } from "@/components/sales/pickers";
import { Button } from "@/components/ui/button";
import type { LetterParty, TemplateChoice } from "@/modules/reports/screens.service";
import { fillTemplateAction, findLetterPartiesAction } from "@/server/actions/templates.actions";

import { FileReadyDialog, type ReadyFile } from "./file-ready";
import { TEMPLATE_RESULT_HINTS } from "./labels";

const KIND_LABELS: Record<string, string> = {
  BUYER: "Buyer",
  SUPPLIER: "Supplier",
  BOTH: "Buyer and supplier",
};

/**
 * A letter on one of the company's letter templates, addressed to a buyer or
 * supplier (for people who may see them) or to no one in particular.
 */
export function WriteLetterButton({
  templates,
  pickParty,
}: {
  templates: TemplateChoice[];
  pickParty: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<LetterParty | null>(null);
  const [ready, setReady] = useState<ReadyFile>();
  if (templates.length === 0) return null;
  const only = templates.length === 1 ? templates[0] : undefined;

  function close() {
    setOpen(false);
    setParty(null);
  }

  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <MailIcon aria-hidden />
        Write a letter
      </Button>
      {open && (
        <FormDialog
          title="Write a letter"
          description={
            only
              ? `Fills "${only.name}"${pickParty ? " with the buyer or supplier you pick" : ""}. ${TEMPLATE_RESULT_HINTS[only.format] ?? ""}`
              : `Pick the letter template${pickParty ? " and who it is for" : ""}.`
          }
          submitLabel="Make the letter"
          pendingLabel="Making the letter"
          errorTitle="We could not make the letter"
          onClose={close}
          onSubmit={async (form) => {
            const templateId = only?.id ?? String(form.get("template") ?? "");
            const result = await fillTemplateAction(templateId, {
              partyId: party?.id,
            });
            if (!result.ok) return result.error;
            close();
            setReady(result.data);
            return undefined;
          }}
        >
          {() => (
            <>
              {!only && (
                <ChoiceList
                  name="template"
                  legend="Letter template"
                  defaultValue={templates[0]!.id}
                  options={templates.map((t) => ({
                    value: t.id,
                    label: t.isDefault ? `${t.name} (default)` : t.name,
                    hint: TEMPLATE_RESULT_HINTS[t.format],
                  }))}
                />
              )}
              {pickParty && (
                <Field
                  id="letter-party"
                  label="To (optional)"
                  hint="Their name, address and phone go where the template has buyer tags."
                >
                  {party ? (
                    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{party.name}</p>
                        <p className="truncate text-[0.8125rem] text-muted-foreground">
                          {[party.code, KIND_LABELS[party.kind], party.city]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setParty(null)}
                        aria-label={`Change who the letter is for (${party.name})`}
                      >
                        <XIcon aria-hidden />
                        Change
                      </Button>
                    </div>
                  ) : (
                    <SearchList<LetterParty>
                      id="letter-party"
                      label="Find a buyer or supplier"
                      placeholder="Name, code or phone"
                      describedBy="letter-party-hint"
                      search={async (text) => {
                        const result = await findLetterPartiesAction({ search: text });
                        return result.ok ? result.data : result.error.message;
                      }}
                      onPick={setParty}
                      renderOption={(p) => (
                        <span className="grid gap-0.5">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          <span className="truncate text-[0.8125rem] text-muted-foreground">
                            {[p.code, KIND_LABELS[p.kind], p.city].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      )}
                    />
                  )}
                </Field>
              )}
            </>
          )}
        </FormDialog>
      )}
      {ready && (
        <FileReadyDialog file={ready} eyebrow="Letter" onClose={() => setReady(undefined)} />
      )}
    </>
  );
}
