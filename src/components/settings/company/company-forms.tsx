"use client";

import { ImageUpIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionError } from "@/lib/result";
import type { CompanyDetails } from "@/modules/companies/company.service";
import {
  removeCompanyLogoAction,
  updateCompanyProfileAction,
  uploadCompanyLogoAction,
} from "@/server/actions/company.actions";

import { currencyChoices, MONTHS } from "./company-options";
import { CompanyLogo } from "./company-logo";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Empty optional text clears the field. */
const optional = (form: FormData, name: string) => text(form, name) || null;

/** A number, or the text as typed so the server can say what is wrong with it. */
function numberOrText(form: FormData, name: string): number | string {
  const raw = text(form, name);
  const value = Number(raw);
  return raw !== "" && Number.isFinite(value) ? value : raw;
}

/** The fields whose value differs from the company's (empty and missing count as the same). */
function changedFields(input: Record<string, unknown>, current: Record<string, unknown>) {
  const plain = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => plain(value) !== plain(current[key])),
  );
}

/**
 * Saving one card: only the fields that changed go to updateCompanyProfileAction
 * (so the audit trail names just those), which checks company.settings and
 * refreshes the screens (the company name shows in the top bar).
 */
function useSave(current: CompanyDetails) {
  const [error, setError] = useState<ActionError>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  return {
    error,
    saved,
    pending,
    fieldError: (field: string) => error?.fieldErrors?.[field]?.[0],
    clearError: () => setError(undefined),
    /** Something was typed since the last save. */
    edited: () => setSaved(false),
    save(input: Record<string, unknown>) {
      const changes = changedFields(input, current);
      if (Object.keys(changes).length === 0) {
        setError(undefined);
        setSaved(true);
        return;
      }
      setSaved(false);
      startTransition(async () => {
        const result = await updateCompanyProfileAction(changes);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(undefined);
        setSaved(true);
      });
    },
  };
}

type Save = ReturnType<typeof useSave>;

function SettingsCard({
  id,
  title,
  description,
  state,
  onSubmit,
  children,
  before,
}: {
  id: string;
  title: string;
  description: string;
  state: Save;
  onSubmit: (form: FormData) => void;
  children: React.ReactNode;
  /** Shown above the form's own fields (the logo, which saves by itself). */
  before?: React.ReactNode;
}) {
  const { error, saved, pending } = state;
  const form = useRef<HTMLFormElement>(null);
  // After a refused save, take the person to the first field that needs fixing.
  useEffect(() => {
    if (error?.fieldErrors)
      form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  }, [error]);

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4 sm:px-6">
        <h3 id={`${id}-title`} className="font-serif text-xl text-primary">
          {title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {before}
      <form
        ref={form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
        onChange={state.edited}
      >
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2 sm:px-6">{children}</div>
        {error && error.code !== "INTERNAL" && !error.fieldErrors && (
          <div className="px-5 pb-5 sm:px-6">
            <FormAlert>{error.message}</FormAlert>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 border-t px-5 py-3 sm:px-6">
          <p className="mr-auto text-sm" aria-live="polite">
            {saved && <span className="text-primary">Saved</span>}
          </p>
          <Button type="submit" disabled={pending}>
            {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      </form>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not save the company details"
          onClose={state.clearError}
        />
      )}
    </section>
  );
}

/** A text field wired to the card's errors. */
function TextField({
  state,
  name,
  label,
  defaultValue,
  hint,
  wide,
  multiline,
  ...props
}: {
  state: Save;
  name: string;
  label: string;
  defaultValue: string | number | null;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
} & Omit<React.ComponentProps<"input">, "defaultValue" | "name">) {
  const error = state.fieldError(name);
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <Field
      id={name}
      label={label}
      hint={hint}
      error={error}
      className={wide ? "sm:col-span-2" : undefined}
    >
      {multiline ? (
        <Textarea
          id={name}
          name={name}
          defaultValue={defaultValue ?? ""}
          maxLength={props.maxLength}
          rows={3}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      ) : (
        <Input
          id={name}
          name={name}
          defaultValue={defaultValue ?? ""}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
      )}
    </Field>
  );
}

function ColorField({
  state,
  name,
  label,
  defaultValue,
}: {
  state: Save;
  name: string;
  label: string;
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue.toLowerCase());
  const error = state.fieldError(name);
  return (
    <Field id={name} label={label} error={error}>
      <div className="flex items-center gap-3">
        <input
          id={name}
          name={name}
          type="color"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={Boolean(error)}
          className="h-11 w-16 cursor-pointer rounded-md border border-input bg-card p-1 md:h-10"
        />
        <span className="font-mono text-sm text-muted-foreground uppercase">{value}</span>
      </div>
    </Field>
  );
}

function LogoControls({ logo }: { logo: CompanyDetails["logo"] }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<ActionError>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError({ code: "VALIDATION", message: "Choose a PNG or JPG image." });
    } else if (file.size > MAX_LOGO_BYTES) {
      setError({ code: "VALIDATION", message: "A logo can be up to 2 MB." });
    } else {
      const form = new FormData();
      form.set("file", file);
      startTransition(async () => {
        const result = await uploadCompanyLogoAction(form);
        setError(result.ok ? undefined : result.error);
      });
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="grid gap-4 border-b px-5 py-5 sm:grid-cols-[auto_1fr] sm:items-center sm:px-6">
      <CompanyLogo logo={logo} />
      <div className="grid gap-3">
        <div>
          <p className="text-sm font-medium">Logo</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Printed at the top of every PDF. A PNG or JPG of up to 2 MB; documents already made keep
            the logo they had.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden />
            ) : (
              <ImageUpIcon aria-hidden />
            )}
            {pending ? "Uploading" : logo ? "Replace logo" : "Upload logo"}
          </Button>
          {logo && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:bg-destructive/5 hover:text-destructive"
              disabled={pending}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2Icon aria-hidden />
              Remove
            </Button>
          )}
        </div>
        {error && error.code !== "INTERNAL" && <FormAlert>{error.message}</FormAlert>}
      </div>
      {error?.code === "INTERNAL" && (
        <ErrorDialog
          code={error.errorId ?? "ERR-UNKNOWN"}
          title="We could not change the logo"
          onClose={() => setError(undefined)}
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove the logo?"
          description="New documents are printed without a logo until you upload another. Documents already made keep theirs."
          confirmLabel="Remove logo"
          pendingLabel="Removing"
          destructive
          errorTitle="We could not remove the logo"
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            const result = await removeCompanyLogoAction();
            if (!result.ok) return result.error;
            setConfirmRemove(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The company settings for people with company.settings: four cards that each
 * save their own fields, and the letterhead logo, which saves as soon as it is
 * chosen.
 */
export function CompanyForms({
  details,
  timeZones,
}: {
  details: CompanyDetails;
  timeZones: string[];
}) {
  const profile = useSave(details);
  const letterhead = useSave(details);
  const rules = useSave(details);
  const regional = useSave(details);

  return (
    <div className="grid gap-6">
      <SettingsCard
        id="profile"
        title="Company details"
        description="How the company is named and reached, as printed on quotations, invoices and statements."
        state={profile}
        onSubmit={(form) =>
          profile.save({
            name: text(form, "name"),
            legalName: optional(form, "legalName"),
            phone: optional(form, "phone"),
            email: optional(form, "email"),
            website: optional(form, "website"),
            address: optional(form, "address"),
          })
        }
      >
        <TextField
          state={profile}
          name="name"
          label="Name"
          defaultValue={details.name}
          hint="Shown in the menu and the company list."
          maxLength={120}
          required
        />
        <TextField
          state={profile}
          name="legalName"
          label="Legal name (optional)"
          defaultValue={details.legalName}
          maxLength={200}
        />
        <TextField
          state={profile}
          name="phone"
          label="Phone"
          defaultValue={details.phone}
          type="tel"
          inputMode="tel"
          maxLength={50}
        />
        <TextField
          state={profile}
          name="email"
          label="Email"
          defaultValue={details.email}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
        />
        <TextField
          state={profile}
          name="website"
          label="Website"
          defaultValue={details.website}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
          wide
        />
        <TextField
          state={profile}
          name="address"
          label="Address"
          defaultValue={details.address}
          maxLength={500}
          multiline
          wide
        />
      </SettingsCard>

      <SettingsCard
        id="letterhead"
        title="Letterhead"
        description="The logo, colours and footer printed on every PDF and on the blank letterhead pad."
        state={letterhead}
        before={<LogoControls logo={details.logo} />}
        onSubmit={(form) =>
          letterhead.save({
            primaryColor: text(form, "primaryColor").toUpperCase(),
            accentColor: text(form, "accentColor").toUpperCase(),
            letterheadFooter: optional(form, "letterheadFooter"),
          })
        }
      >
        <ColorField
          state={letterhead}
          name="primaryColor"
          label="Main colour"
          defaultValue={details.primaryColor}
        />
        <ColorField
          state={letterhead}
          name="accentColor"
          label="Accent colour"
          defaultValue={details.accentColor}
        />
        <TextField
          state={letterhead}
          name="letterheadFooter"
          label="Footer"
          defaultValue={details.letterheadFooter}
          hint="A line at the bottom of each page, such as your registration numbers."
          maxLength={500}
          multiline
          wide
        />
      </SettingsCard>

      <SettingsCard
        id="rules"
        title="Business rules"
        description="Defaults the sales, stock and buyer screens use."
        state={rules}
        onSubmit={(form) =>
          rules.save({
            lowStockThreshold: numberOrText(form, "lowStockThreshold"),
            defaultAdvancePercent: numberOrText(form, "defaultAdvancePercent"),
            dormantAfterMonths: numberOrText(form, "dormantAfterMonths"),
          })
        }
      >
        <TextField
          state={rules}
          name="lowStockThreshold"
          label="Low stock alert at"
          defaultValue={details.lowStockThreshold}
          hint="Pieces left of a SKU before it shows as low stock."
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          step={1}
        />
        <TextField
          state={rules}
          name="defaultAdvancePercent"
          label="Advance on orders (%)"
          defaultValue={details.defaultAdvancePercent}
          hint="The advance asked for on a new sales order."
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="any"
        />
        <TextField
          state={rules}
          name="dormantAfterMonths"
          label="Buyer counts as dormant after (months)"
          defaultValue={details.dormantAfterMonths}
          hint="Months without an order before a buyer is offered for re-engagement."
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          step={1}
          wide
        />
      </SettingsCard>

      <SettingsCard
        id="regional"
        title="Money and time"
        description="Changing these does not convert amounts already recorded, and moves the day boundaries of reports."
        state={regional}
        onSubmit={(form) =>
          regional.save({
            currency: text(form, "currency"),
            timezone: text(form, "timezone"),
            fiscalYearStartMonth: numberOrText(form, "fiscalYearStartMonth"),
          })
        }
      >
        <Field id="currency" label="Currency" error={regional.fieldError("currency")}>
          <NativeSelect
            id="currency"
            name="currency"
            defaultValue={details.currency}
            containerClassName="sm:w-full"
            className="md:h-10"
            aria-invalid={Boolean(regional.fieldError("currency"))}
          >
            {currencyChoices(details.currency).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="timezone" label="Time zone" error={regional.fieldError("timezone")}>
          <NativeSelect
            id="timezone"
            name="timezone"
            defaultValue={details.timezone}
            containerClassName="sm:w-full"
            className="md:h-10"
            aria-invalid={Boolean(regional.fieldError("timezone"))}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          id="fiscalYearStartMonth"
          label="Financial year starts in"
          hint="July for the Bangladesh income year (July to June)."
          error={regional.fieldError("fiscalYearStartMonth")}
          className="sm:col-span-2"
        >
          <NativeSelect
            id="fiscalYearStartMonth"
            name="fiscalYearStartMonth"
            defaultValue={String(details.fiscalYearStartMonth)}
            containerClassName="sm:w-full"
            className="md:h-10"
            aria-describedby="fiscalYearStartMonth-hint"
          >
            {MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </SettingsCard>
    </div>
  );
}
