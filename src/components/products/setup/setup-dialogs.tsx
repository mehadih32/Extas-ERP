"use client";

import { LoaderCircleIcon, LockIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ActionError } from "@/lib/result";
import { cn } from "@/lib/utils";
import type { CatalogSetup } from "@/modules/inventory/screens.service";

import { Swatch } from "../bits";
import { parentChoices } from "../catalog-helpers";
import { COLOR_PRESETS } from "./color-presets";

type Category = CatalogSetup["categories"][number];

/** Runs the save; returns its error, if any, which the dialog shows. */
type Save<T> = (value: T) => Promise<ActionError | undefined>;

/** The frame every setup dialog shares: title, fields, the error and the buttons. */
function SetupDialog({
  title,
  description,
  saveLabel,
  error,
  fieldNames,
  pending,
  pendingLabel = "Saving",
  destructive = false,
  onSubmit,
  onClose,
  onDismissError,
  children,
}: {
  title: string;
  description?: string;
  saveLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  error: ActionError | undefined;
  /** The fields that show their own errors; anything else shows above the buttons. */
  fieldNames: string[];
  pending: boolean;
  onSubmit: (form: FormData) => void;
  onClose: () => void;
  onDismissError: () => void;
  children: React.ReactNode;
}) {
  const onField = fieldNames.some((name) => error?.fieldErrors?.[name]);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(new FormData(event.currentTarget));
          }}
          className="grid gap-5"
          noValidate
        >
          {children}
          {error && error.code !== "INTERNAL" && !onField && <FormAlert>{error.message}</FormAlert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
              {pending ? pendingLabel : saveLabel}
            </Button>
          </DialogFooter>
        </form>
        {error?.code === "INTERNAL" && (
          <ErrorDialog
            code={error.errorId ?? "ERR-UNKNOWN"}
            title={`We could not save: ${title.toLowerCase()}`}
            onClose={onDismissError}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** State every setup dialog keeps: the error and whether it is saving. */
function useSave<T>(save: Save<T>) {
  const [error, setError] = useState<ActionError>();
  const [pending, startTransition] = useTransition();
  const run = (value: T) =>
    startTransition(async () => {
      setError(await save(value));
    });
  return { error, pending, run, dismiss: () => setError(undefined) };
}

const fieldError = (error: ActionError | undefined, name: string) =>
  error?.fieldErrors?.[name]?.[0];

/** A name on its own: a brand or a size, new or renamed. */
export function NameDialog({
  title,
  description,
  label,
  initial = "",
  hint,
  maxLength,
  saveLabel,
  onSave,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  initial?: string;
  hint?: string;
  maxLength: number;
  saveLabel: string;
  onSave: Save<string>;
  onClose: () => void;
}) {
  const { error, pending, run, dismiss } = useSave(onSave);
  const problem = fieldError(error, "name");
  return (
    <SetupDialog
      title={title}
      description={description}
      saveLabel={saveLabel}
      error={error}
      fieldNames={["name"]}
      pending={pending}
      onSubmit={(form) => run(String(form.get("name") ?? "").trim())}
      onClose={onClose}
      onDismissError={dismiss}
    >
      <Field id="setup-name" label={label} hint={hint} error={problem}>
        <Input
          id="setup-name"
          name="name"
          defaultValue={initial}
          maxLength={maxLength}
          autoComplete="off"
          aria-invalid={Boolean(problem)}
          aria-describedby={problem ? "setup-name-error" : hint ? "setup-name-hint" : undefined}
          autoFocus
          required
        />
      </Field>
    </SetupDialog>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour: its name and the swatch shown in the matrix and on stock sheets. */
export function ColorDialog({
  color,
  onSave,
  onClose,
}: {
  color?: { name: string; hexCode: string; variantCount: number };
  onSave: Save<{ name: string; hexCode: string }>;
  onClose: () => void;
}) {
  const { error, pending, run, dismiss } = useSave(onSave);
  const [hex, setHex] = useState(color?.hexCode ?? "#1F2A44");
  const [name, setName] = useState(color?.name ?? "");
  const nameProblem = fieldError(error, "name");
  const hexProblem = fieldError(error, "hexCode");
  return (
    <SetupDialog
      title={color ? `Edit ${color.name}` : "Add a colour"}
      description={
        color && color.variantCount > 0
          ? "SKUs already made keep their codes, so printed tags stay valid."
          : "Colours are the rows of every style's matrix."
      }
      saveLabel={color ? "Save" : "Add colour"}
      error={error}
      fieldNames={["name", "hexCode"]}
      pending={pending}
      onSubmit={() => run({ name: name.trim(), hexCode: hex.trim() })}
      onClose={onClose}
      onDismissError={dismiss}
    >
      <Field id="color-name" label="Name" error={nameProblem}>
        <Input
          id="color-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="off"
          placeholder="Like Navy, or Black & White Stripes"
          aria-invalid={Boolean(nameProblem)}
          aria-describedby={nameProblem ? "color-name-error" : undefined}
          autoFocus
          required
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Quick pick</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-2">
          {COLOR_PRESETS.map((preset) => {
            const chosen = hex.toUpperCase() === preset.hex;
            return (
              <button
                key={preset.hex}
                type="button"
                title={preset.name}
                aria-label={preset.name}
                aria-pressed={chosen}
                onClick={() => {
                  setHex(preset.hex);
                  if (!name.trim()) setName(preset.name);
                }}
                className={cn(
                  "size-10 justify-self-center rounded-full border border-black/15 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  chosen && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: preset.hex }}
              />
            );
          })}
        </div>
      </fieldset>
      <Field
        id="color-hex"
        label="Swatch"
        hint="Tap a quick pick, use the picker, or type a hex code."
        error={hexProblem}
      >
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label="Pick the colour"
            value={HEX.test(hex) ? hex : "#000000"}
            onChange={(e) => setHex(e.target.value.toUpperCase())}
            className="h-11 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1 md:h-10"
          />
          <Input
            id="color-hex"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            className="uppercase sm:max-w-36"
            aria-invalid={Boolean(hexProblem)}
            aria-describedby={hexProblem ? "color-hex-error" : "color-hex-hint"}
          />
        </div>
      </Field>
      <div
        aria-label="Preview"
        className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5"
      >
        <Swatch hex={HEX.test(hex) ? hex : "#FFFFFF"} className="size-7" />
        <span className="min-w-0 text-sm font-medium break-words">
          {name.trim() || "Colour name"}
        </span>
      </div>
    </SetupDialog>
  );
}

const indented = (c: Category) => `${"   ".repeat(c.depth)}${c.name}`;

/** A category: its name and where it sits in the tree. */
export function CategoryDialog({
  category,
  parentId,
  categories,
  onSave,
  onClose,
}: {
  /** The category being edited, or none for a new one. */
  category?: Category;
  /** Where a new one goes (a sub-category), or where the edited one is now. */
  parentId: string | null;
  categories: Category[];
  onSave: Save<{ name: string; parentId: string | null }>;
  onClose: () => void;
}) {
  const { error, pending, run, dismiss } = useSave(onSave);
  const nameProblem = fieldError(error, "name");
  const choices = parentChoices(categories, category?.id);
  const parentName = categories.find((c) => c.id === parentId)?.name;
  return (
    <SetupDialog
      title={
        category ? `Edit ${category.name}` : parentName ? `Add to ${parentName}` : "Add a category"
      }
      description="Styles are filed under categories, which can sit inside one another (Tops, then Polos)."
      saveLabel={category ? "Save" : "Add category"}
      error={error}
      fieldNames={["name", "parentId"]}
      pending={pending}
      onSubmit={(form) =>
        run({
          name: String(form.get("name") ?? "").trim(),
          parentId: String(form.get("parentId") ?? "") || null,
        })
      }
      onClose={onClose}
      onDismissError={dismiss}
    >
      <Field id="category-name" label="Name" error={nameProblem}>
        <Input
          id="category-name"
          name="name"
          defaultValue={category?.name}
          maxLength={120}
          autoComplete="off"
          aria-invalid={Boolean(nameProblem)}
          aria-describedby={nameProblem ? "category-name-error" : undefined}
          autoFocus
          required
        />
      </Field>
      <Field id="category-parent" label="Inside" error={fieldError(error, "parentId")}>
        <NativeSelect
          id="category-parent"
          name="parentId"
          defaultValue={parentId ?? ""}
          containerClassName="sm:w-full"
          className="md:h-10"
        >
          <option value="">Nothing (a top category)</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {indented(c)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </SetupDialog>
  );
}

/** A new warehouse: its name, address and whether stock goes there by default. */
export function WarehouseDialog({
  onSave,
  onClose,
}: {
  onSave: Save<{ name: string; address: string | null; isDefault: boolean }>;
  onClose: () => void;
}) {
  const { error, pending, run, dismiss } = useSave(onSave);
  const nameProblem = fieldError(error, "name");
  return (
    <SetupDialog
      title="Add a warehouse"
      description="Each warehouse keeps its own stock. Counts, deliveries and sales say which one."
      saveLabel="Add warehouse"
      error={error}
      fieldNames={["name", "address"]}
      pending={pending}
      onSubmit={(form) =>
        run({
          name: String(form.get("name") ?? "").trim(),
          address: String(form.get("address") ?? "").trim() || null,
          isDefault: form.get("isDefault") === "on",
        })
      }
      onClose={onClose}
      onDismissError={dismiss}
    >
      <Field id="warehouse-name" label="Name" error={nameProblem}>
        <Input
          id="warehouse-name"
          name="name"
          maxLength={120}
          autoComplete="off"
          placeholder="Like Mirpur Store"
          aria-invalid={Boolean(nameProblem)}
          aria-describedby={nameProblem ? "warehouse-name-error" : undefined}
          autoFocus
          required
        />
      </Field>
      <Field id="warehouse-address" label="Address (optional)" error={fieldError(error, "address")}>
        <Input id="warehouse-address" name="address" maxLength={300} autoComplete="off" />
      </Field>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="isDefault"
          className="mt-0.5 size-4 cursor-pointer accent-primary"
        />
        <span>
          <span className="font-medium">Make it the default</span>
          <span className="block text-muted-foreground">
            Where stock goes when nobody picks a warehouse.
          </span>
        </span>
      </label>
    </SetupDialog>
  );
}

type Warehouse = CatalogSetup["warehouses"][number];

/**
 * Deleting a warehouse (a Super Admin only): one that still holds stock or open
 * work says why it cannot go yet; an empty one asks for the password again.
 */
export function DeleteWarehouseDialog({
  warehouse,
  onDelete,
  onClose,
}: {
  warehouse: Warehouse;
  onDelete: Save<{ password: string }>;
  onClose: () => void;
}) {
  const { error, pending, run, dismiss } = useSave(onDelete);
  const problem = fieldError(error, "password");
  if (warehouse.blocked) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{warehouse.name} cannot be deleted yet</DialogTitle>
            <DialogDescription>Only an empty warehouse can be deleted.</DialogDescription>
          </DialogHeader>
          <FormAlert tone="note">
            <span className="flex items-start gap-2">
              <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {warehouse.blocked}
            </span>
          </FormAlert>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <SetupDialog
      title={`Delete ${warehouse.name}?`}
      description={`It is empty, so it can go. Its past stock movements keep its name in the history.${
        warehouse.isDefault ? " The oldest warehouse left becomes the default." : ""
      }`}
      saveLabel="Delete warehouse"
      pendingLabel="Deleting"
      destructive
      error={error}
      fieldNames={["password"]}
      pending={pending}
      onSubmit={(form) => run({ password: String(form.get("password") ?? "") })}
      onClose={onClose}
      onDismissError={dismiss}
    >
      <Field
        id="warehouse-password"
        label="Your password"
        hint="For safety, type the password you sign in with."
        error={problem}
      >
        <Input
          id="warehouse-password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(problem)}
          aria-describedby={problem ? "warehouse-password-error" : "warehouse-password-hint"}
          autoFocus
          required
        />
      </Field>
    </SetupDialog>
  );
}
