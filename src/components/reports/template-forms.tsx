"use client";

import { CodeIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field } from "@/components/forms/field";
import { textOf } from "@/components/products/form-values";
import { FormDialog, problem } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createHtmlTemplateAction, uploadTemplateAction } from "@/server/actions/templates.actions";

import { reportsHref, TEMPLATE_FORMAT_HINTS } from "./labels";
import { STARTER_HTML } from "./starter-html";

type Kind = { key: string; label: string };

/** The server takes up to 10 MB; the form around the file needs a little room. */
const MAX_FILE_BYTES = 10 * 1024 * 1024 - 64 * 1024;
const ACCEPT =
  ".docx,.html,.htm,.pdf,.png,.jpg,.jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,application/pdf,image/png,image/jpeg";

function NameField({ error, id }: { error?: string; id: string }) {
  return (
    <Field
      id={id}
      label="Name"
      hint='What people pick it by, like "Quotation with bank details".'
      error={error}
    >
      <Input
        id={id}
        name="name"
        required
        minLength={2}
        maxLength={120}
        autoComplete="off"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
      />
    </Field>
  );
}

function KindField({
  id,
  kinds,
  error,
  onChange,
}: {
  id: string;
  kinds: Kind[];
  error?: string;
  onChange?: (kind: string) => void;
}) {
  return (
    <Field id={id} label="For" error={error}>
      <NativeSelect
        id={id}
        name="documentType"
        defaultValue={kinds[0]?.key}
        containerClassName="sm:w-full"
        onChange={(e) => onChange?.(e.target.value)}
      >
        {kinds.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function DefaultField({ id }: { id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        id={id}
        type="checkbox"
        name="isDefault"
        value="true"
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
      />
      <span>
        Offer it first
        <span className="block text-[0.8125rem] text-muted-foreground">
          The design picked at the start when this kind of document is filled.
        </span>
      </span>
    </label>
  );
}

/**
 * Uploads a template: a Word file, a PDF, an HTML page or a picture of the
 * company's pad, then opens it to check its tags or place them.
 */
export function AddTemplateButton({ kinds }: { kinds: Kind[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        <UploadIcon aria-hidden />
        Add a template
      </Button>
      {open && (
        <FormDialog
          title="Add a template"
          description="Upload your own design. Where the data goes, a Word or HTML file has tags like {BuyerName}; on a PDF or a picture you place the tags after uploading."
          submitLabel="Upload"
          pendingLabel="Uploading"
          errorTitle="We could not add the template"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const file = form.get("file");
            if (!(file instanceof File) || file.size === 0) {
              return problem({ file: "Choose the file." });
            }
            if (file.size > MAX_FILE_BYTES) return problem({ file: "Files can be up to 10 MB." });
            if (textOf(form, "name").length < 2) return problem({ name: "Give it a name." });
            if (!form.has("isDefault")) form.set("isDefault", "false");
            const result = await uploadTemplateAction(form);
            if (!result.ok) return result.error;
            setOpen(false);
            router.push(`${reportsHref.template(result.data.id)}?added=1`);
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              <NameField id="template-name" error={fieldError("name")} />
              <KindField id="template-kind" kinds={kinds} error={fieldError("documentType")} />
              <Field
                id="template-file"
                label="File"
                hint="A Word file (.docx), a PDF, an HTML page, or a JPG or PNG of your pad. Up to 10 MB."
                error={fieldError("file")}
              >
                <Input
                  id="template-file"
                  name="file"
                  type="file"
                  accept={ACCEPT}
                  className="h-auto py-1.5 file:mr-3"
                  aria-invalid={Boolean(fieldError("file"))}
                  aria-describedby={
                    fieldError("file") ? "template-file-error" : "template-file-hint"
                  }
                />
              </Field>
              <ul className="grid gap-1 text-[0.8125rem] text-muted-foreground">
                {(["WORD", "PDF", "IMAGE"] as const).map((format) => (
                  <li key={format}>
                    <span className="font-medium text-foreground">
                      {format === "WORD" ? "Word or HTML" : format === "PDF" ? "PDF" : "Picture"}:
                    </span>{" "}
                    {TEMPLATE_FORMAT_HINTS[format]}
                  </li>
                ))}
              </ul>
              <DefaultField id="template-default" />
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}

/** Writes an HTML template here, starting from a simple page for the kind of document. */
export function WriteHtmlButton({ kinds }: { kinds: Kind[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(kinds[0]?.key ?? "");
  const [html, setHtml] = useState(STARTER_HTML[kinds[0]?.key ?? ""] ?? "");
  const [edited, setEdited] = useState(false);

  function start() {
    const first = kinds[0]?.key ?? "";
    setKind(first);
    setHtml(STARTER_HTML[first] ?? "");
    setEdited(false);
    setOpen(true);
  }

  return (
    <>
      <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={start}>
        <CodeIcon aria-hidden />
        Write an HTML template
      </Button>
      {open && (
        <FormDialog
          className="sm:max-w-2xl"
          title="Write an HTML template"
          description="A web page with tags like {BuyerName} where the data goes. It starts from a simple page for the kind of document; change it as you like. Filled copies download as a page to print from the browser."
          submitLabel="Save the template"
          pendingLabel="Saving"
          errorTitle="We could not save the template"
          onClose={() => setOpen(false)}
          onSubmit={async (form) => {
            const name = textOf(form, "name");
            if (name.length < 2) return problem({ name: "Give it a name." });
            if (!html.trim()) return problem({ html: "Write the page." });
            const result = await createHtmlTemplateAction({
              name,
              documentType: kind,
              html,
              isDefault: form.has("isDefault"),
            });
            if (!result.ok) return result.error;
            setOpen(false);
            router.push(`${reportsHref.template(result.data.id)}?added=1`);
            return undefined;
          }}
        >
          {(fieldError) => (
            <>
              <NameField id="html-name" error={fieldError("name")} />
              <KindField
                id="html-kind"
                kinds={kinds}
                error={fieldError("documentType")}
                onChange={(next) => {
                  setKind(next);
                  if (!edited) setHtml(STARTER_HTML[next] ?? "");
                }}
              />
              <Field
                id="html-page"
                label="The page"
                hint="Scripts, forms and frames are not allowed. A table row with item tags repeats for every line."
                error={fieldError("html")}
              >
                <Textarea
                  id="html-page"
                  value={html}
                  onChange={(e) => {
                    setHtml(e.target.value);
                    setEdited(true);
                  }}
                  rows={14}
                  spellCheck={false}
                  className="font-mono text-[0.8125rem] md:text-[0.8125rem]"
                  aria-invalid={Boolean(fieldError("html"))}
                  aria-describedby={fieldError("html") ? "html-page-error" : "html-page-hint"}
                />
              </Field>
              <DefaultField id="html-default" />
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}
