"use client";

import {
  BadgeCheckIcon,
  DownloadIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UndoIcon,
  UploadIcon,
} from "lucide-react";
import { useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { productionHref } from "@/components/production/labels";
import { Panel } from "@/components/sales/detail-bits";
import { FormDialog } from "@/components/sales/dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDay } from "@/lib/display";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import { REFERENCE_STITCHES } from "@/modules/production/logo-files";
import { LOGO_FABRICS, LOGO_SOURCE_LABELS } from "@/modules/production/tech-pack-labels";
import type { TechPackScreen } from "@/modules/production/tech-pack-screen.service";
import {
  draftLogoFromVectorAction,
  removeLogoAction,
  saveLogoAction,
  tickLogoAction,
  uploadLogoFileAction,
  untickLogoAction,
} from "@/server/actions/tech-pack.actions";

import { SignalMark } from "./signals";

/*
 * Logos and embroidery: each logo's spec (size, threads, fabric, stitches),
 * then its machine file in the blueprint's order: the buyer's file, the
 * embroidery factory's puncher, or a draft from the buyer's vector. Every
 * machine file is checked against the spec; a sew-out photo and the owner's
 * tick come before bulk, and a ticked logo is locked.
 */

type Logo = TechPackScreen["logos"][number];

const VERDICT_TONE = {
  PASS: "text-success",
  WARN: "text-amber-700 dark:text-amber-400",
  FAIL: "text-destructive",
} as const;

const logoUrl = (techPackId: string, logoId: string, end: string) =>
  `/api/tech-packs/${encodeURIComponent(techPackId)}/logos/${encodeURIComponent(logoId)}/${end}`;

const mm = (n: number | null) => (n === null ? null : `${n} mm`);

export function LogosPanel({ screen }: { screen: TechPackScreen }) {
  const { techPack, logos, can } = screen;
  const [open, setOpen] = useState<
    | { kind: "spec"; logo: Logo | null }
    | { kind: "upload"; logo: Logo }
    | { kind: "remove"; logo: Logo }
    | { kind: "tick"; logo: Logo }
    | null
  >(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  const run = (work: () => Promise<{ ok: true } | { ok: false; error: ActionError }>) =>
    startTransition(async () => {
      const result = await work();
      setError(result.ok ? undefined : result.error);
    });

  return (
    <Panel
      title="Logos and embroidery"
      id="tech-pack-logos-heading"
      action={
        can.edit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen({ kind: "spec", logo: null })}
          >
            <PlusIcon aria-hidden />
            Add a logo
          </Button>
        ) : null
      }
    >
      {error && (
        <div className="mt-3">
          <FormAlert>{error.message}</FormAlert>
        </div>
      )}
      {logos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No logo on this style. Add each embroidered logo with its size and threads; its machine
          file comes from the buyer first, then the embroidery factory&apos;s puncher, and only then
          a draft from the buyer&apos;s vector file.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {logos.map((logo) => {
            const locked = logo.tickedOn !== null;
            const spec = [
              logo.placement,
              [mm(logo.widthMm), mm(logo.heightMm)].filter(Boolean).join(" × "),
              logo.threads,
              logo.colours ? `${logo.colours} colour(s)` : null,
              logo.fabric ? LOGO_FABRICS[logo.fabric as keyof typeof LOGO_FABRICS] : null,
              logo.approvedStitches
                ? `${logo.approvedStitches.toLocaleString("en-US")} stitches approved`
                : null,
            ].filter(Boolean);
            const vector = logo.artwork && /\.svg$/i.test(logo.artwork.fileName);
            return (
              <li key={logo.id} className="rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <SignalMark signal={logo.signal} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{logo.name}</p>
                    {spec.length > 0 && (
                      <p className="text-sm text-muted-foreground">{spec.join(" · ")}</p>
                    )}
                  </div>
                  {can.edit && !locked && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Change the logo"
                        onClick={() => setOpen({ kind: "spec", logo })}
                      >
                        <PencilIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove the logo"
                        onClick={() => setOpen({ kind: "remove", logo })}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  <FileLine label="Artwork" file={logo.artwork} />
                  <div className="min-w-0">
                    <dt className="text-[0.75rem] text-muted-foreground">Machine file</dt>
                    <dd className="break-words">
                      {logo.machineFile ? (
                        <>
                          <a
                            href={logoUrl(techPack.id, logo.id, "file")}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {logo.machineFile.fileName}
                          </a>
                          {logo.source && (
                            <span className="block text-[0.75rem] text-muted-foreground">
                              {LOGO_SOURCE_LABELS[logo.source]}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-destructive">Missing</span>
                      )}
                    </dd>
                  </div>
                  <FileLine label="Sew-out photo" file={logo.sewOut} note={logo.sewOutNote} />
                </dl>

                {logo.check && (
                  <div className="mt-3 rounded-md bg-secondary/40 p-2.5 text-sm">
                    <p className={cn("font-medium", VERDICT_TONE[logo.check.verdict])}>
                      File check: {logo.check.verdict}
                    </p>
                    <p className="text-muted-foreground">
                      {logo.check.stitches.toLocaleString("en-US")} stitches, {logo.check.widthMm} ×{" "}
                      {logo.check.heightMm} mm, {logo.check.colours} colour(s), longest stitch{" "}
                      {logo.check.longestStitchMm} mm
                    </p>
                    {logo.check.notes.length > 0 && (
                      <ul className="mt-1 grid list-disc gap-0.5 pl-5 text-[0.8125rem]">
                        {logo.check.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {locked && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-success">
                    <BadgeCheckIcon className="size-4" aria-hidden />
                    Ticked for bulk on {formatDay(logo.tickedOn!)}
                    {logo.tickedBy ? ` by ${logo.tickedBy}` : ""}. The machine file is locked.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {can.edit && !locked && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setOpen({ kind: "upload", logo })}
                    >
                      <UploadIcon aria-hidden />
                      Upload a file
                    </Button>
                  )}
                  {can.edit && !locked && vector && !logo.machineFile && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => draftLogoFromVectorAction(techPack.id, logo.id))}
                    >
                      <SparklesIcon aria-hidden />
                      Draft from the vector
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" asChild>
                    <a href={logoUrl(techPack.id, logo.id, "brief")} download>
                      <FileTextIcon aria-hidden />
                      Digitizing brief
                    </a>
                  </Button>
                  {logo.machineFile && logo.check && (
                    <>
                      <Button type="button" size="sm" variant="ghost" asChild>
                        <a href={`${logoUrl(techPack.id, logo.id, "file")}?format=DST`} download>
                          <DownloadIcon aria-hidden />
                          DST
                        </a>
                      </Button>
                      <Button type="button" size="sm" variant="ghost" asChild>
                        <a href={`${logoUrl(techPack.id, logo.id, "file")}?format=EXP`} download>
                          <DownloadIcon aria-hidden />
                          EXP
                        </a>
                      </Button>
                    </>
                  )}
                  {can.tick && !locked && logo.machineFile && logo.sewOut && (
                    <Button type="button" size="sm" onClick={() => setOpen({ kind: "tick", logo })}>
                      <BadgeCheckIcon aria-hidden />
                      Tick for bulk
                    </Button>
                  )}
                  {can.tick && locked && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => untickLogoAction(techPack.id, logo.id))}
                    >
                      <UndoIcon aria-hidden />
                      Take back the tick
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open?.kind === "spec" && (
        <LogoSpecDialog techPackId={techPack.id} logo={open.logo} onClose={() => setOpen(null)} />
      )}

      {open?.kind === "upload" && (
        <UploadDialog techPackId={techPack.id} logo={open.logo} onClose={() => setOpen(null)} />
      )}

      {open?.kind === "remove" && (
        <ConfirmDialog
          title={`Remove ${open.logo.name}?`}
          description="The logo and its files are taken off this tech pack."
          confirmLabel="Remove"
          pendingLabel="Removing"
          destructive
          onClose={() => setOpen(null)}
          onConfirm={async () => {
            const result = await removeLogoAction(techPack.id, open.logo.id);
            if (!result.ok) return result.error;
            setOpen(null);
          }}
        />
      )}

      {open?.kind === "tick" && (
        <ConfirmDialog
          title={`Tick ${open.logo.name} for bulk?`}
          description="You have seen the sew-out and the logo is right. Its machine file is then locked; bulk embroidery uses this file only."
          confirmLabel="Tick for bulk"
          pendingLabel="Ticking"
          onClose={() => setOpen(null)}
          onConfirm={async () => {
            const result = await tickLogoAction(techPack.id, open.logo.id);
            if (!result.ok) return result.error;
            setOpen(null);
          }}
        />
      )}
    </Panel>
  );
}

function FileLine({
  label,
  file,
  note,
}: {
  label: string;
  file: { id: string; fileName: string } | null;
  note?: string | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-muted-foreground">{label}</dt>
      <dd className="break-words">
        {file ? (
          <a
            href={productionHref.file(file.id)}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            {file.fileName}
          </a>
        ) : (
          <span className="text-destructive">Missing</span>
        )}
        {note && <span className="block text-[0.75rem] text-muted-foreground">{note}</span>}
      </dd>
    </div>
  );
}

function LogoSpecDialog({
  techPackId,
  logo,
  onClose,
}: {
  techPackId: string;
  logo: Logo | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title={logo ? `Change ${logo.name}` : "Add a logo"}
      description="The size, threads and fabric the machine file is checked against."
      submitLabel="Save"
      pendingLabel="Saving"
      errorTitle="We could not save the logo"
      className="sm:max-w-xl"
      onClose={onClose}
      onSubmit={async (form) => {
        const result = await saveLogoAction(techPackId, logo?.id ?? null, Object.fromEntries(form));
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="logo-name" label="Name" error={fieldError("name")} className="sm:col-span-2">
            <Input id="logo-name" name="name" defaultValue={logo?.name ?? ""} required />
          </Field>
          <Field
            id="logo-placement"
            label="Placement"
            hint="Left chest, back neck…"
            error={fieldError("placement")}
            className="sm:col-span-2"
          >
            <Input id="logo-placement" name="placement" defaultValue={logo?.placement ?? ""} />
          </Field>
          <Field id="logo-width" label="Width (mm)" error={fieldError("widthMm")}>
            <Input
              id="logo-width"
              name="widthMm"
              inputMode="decimal"
              defaultValue={logo?.widthMm ?? ""}
            />
          </Field>
          <Field id="logo-height" label="Height (mm)" error={fieldError("heightMm")}>
            <Input
              id="logo-height"
              name="heightMm"
              inputMode="decimal"
              defaultValue={logo?.heightMm ?? ""}
            />
          </Field>
          <Field
            id="logo-threads"
            label="Threads"
            hint="Brand and codes, e.g. Madeira 1801, 1147."
            error={fieldError("threads")}
            className="sm:col-span-2"
          >
            <Input id="logo-threads" name="threads" defaultValue={logo?.threads ?? ""} />
          </Field>
          <Field id="logo-colours" label="Thread colours" error={fieldError("colours")}>
            <Input
              id="logo-colours"
              name="colours"
              inputMode="numeric"
              defaultValue={logo?.colours ?? ""}
            />
          </Field>
          <Field id="logo-fabric" label="Fabric" error={fieldError("fabric")}>
            <NativeSelect
              id="logo-fabric"
              name="fabric"
              defaultValue={logo?.fabric ?? ""}
              containerClassName="sm:w-full"
            >
              <option value="">Not given</option>
              {Object.entries(LOGO_FABRICS).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            id="logo-stitches"
            label="Approved stitches"
            hint="From the buyer's approved sample, if known."
            error={fieldError("approvedStitches")}
            className="sm:col-span-2"
          >
            <Input
              id="logo-stitches"
              name="approvedStitches"
              inputMode="numeric"
              defaultValue={logo?.approvedStitches ?? ""}
            />
          </Field>
          <Field
            id="logo-reference"
            label="Public reference"
            hint="A well-known logo of the same kind: a file far off its stitch count gets a second look."
            error={fieldError("reference")}
            className="sm:col-span-2"
          >
            <NativeSelect
              id="logo-reference"
              name="reference"
              defaultValue={logo?.reference ?? ""}
              containerClassName="sm:w-full"
            >
              <option value="">None</option>
              {Object.entries(REFERENCE_STITCHES).map(([name, stitches]) => (
                <option key={name} value={name}>
                  {name} ({stitches.toLocaleString("en-US")} stitches)
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

function UploadDialog({
  techPackId,
  logo,
  onClose,
}: {
  techPackId: string;
  logo: Logo;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"ARTWORK" | "MACHINE" | "SEW_OUT">(
    logo.artwork ? "MACHINE" : "ARTWORK",
  );
  return (
    <FormDialog
      title={`Upload a file for ${logo.name}`}
      description="The buyer's artwork, the machine file or the sew-out photo. A machine file is checked against the logo's spec at once."
      submitLabel="Upload"
      pendingLabel="Uploading"
      errorTitle="We could not upload the file"
      onClose={onClose}
      onSubmit={async (form) => {
        const result = await uploadLogoFileAction(techPackId, logo.id, form);
        if (!result.ok) return result.error;
        onClose();
      }}
    >
      {(fieldError) => (
        <div className="grid gap-4">
          <Field id="logo-kind" label="File" error={fieldError("kind")}>
            <NativeSelect
              id="logo-kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              containerClassName="sm:w-full"
            >
              <option value="ARTWORK">The buyer&apos;s artwork (SVG, PDF, AI or EPS)</option>
              <option value="MACHINE">Machine file (DST, EXP, PES, JEF, U01)</option>
              <option value="SEW_OUT">Sew-out photo</option>
            </NativeSelect>
          </Field>
          {kind === "MACHINE" && (
            <Field id="logo-source" label="From" error={fieldError("source")}>
              <NativeSelect
                id="logo-source"
                name="source"
                defaultValue="BUYER_FILE"
                containerClassName="sm:w-full"
              >
                <option value="BUYER_FILE">{LOGO_SOURCE_LABELS.BUYER_FILE}</option>
                <option value="FACTORY_PUNCHER">{LOGO_SOURCE_LABELS.FACTORY_PUNCHER}</option>
              </NativeSelect>
            </Field>
          )}
          <Field
            id="logo-file"
            label="Choose the file"
            hint={kind === "MACHINE" ? "Wilcom EMB is not used: ask for DST." : "Up to 10 MB."}
            error={fieldError("file")}
          >
            <Input id="logo-file" name="file" type="file" required />
          </Field>
          {kind === "SEW_OUT" && (
            <Field id="logo-note" label="Note" error={fieldError("note")}>
              <Textarea
                id="logo-note"
                name="note"
                rows={2}
                placeholder="Sewn on the bulk fabric, size checked…"
              />
            </Field>
          )}
        </div>
      )}
    </FormDialog>
  );
}
