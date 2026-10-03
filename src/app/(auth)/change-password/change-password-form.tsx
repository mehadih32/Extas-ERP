"use client";

import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/routes";
import { changePasswordFormAction } from "@/server/actions/auth-forms.actions";

const FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;

export function ChangePasswordForm({ firstTime }: { firstTime: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordFormAction, null);
  const [dismissedErrorId, setDismissedErrorId] = useState<string>();
  const error = state?.error;
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = FIELDS.some((name) => fieldError(name));

  if (state?.changed) {
    const others = state.changed.otherSessionsRevoked;
    return (
      <div className="mt-8 grid gap-6">
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-primary/20 bg-secondary p-4"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon className="size-4" aria-hidden />
          </span>
          <div className="text-sm leading-relaxed">
            <p className="font-medium text-primary">Your password has been changed.</p>
            <p className="text-muted-foreground">
              {others > 0
                ? `${others} other ${others === 1 ? "device was" : "devices were"} signed out.`
                : "Use it the next time you sign in."}
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="w-full">
          <Link href={ROUTES.home}>Back to the dashboard</Link>
        </Button>
      </div>
    );
  }

  const describe = (name: string) => (fieldError(name) ? `${name}-error` : undefined);

  return (
    <form action={formAction} className="mt-8 grid gap-5" noValidate>
      <Field
        id="currentPassword"
        label={firstTime ? "Temporary password" : "Current password"}
        error={fieldError("currentPassword")}
      >
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          aria-invalid={Boolean(fieldError("currentPassword"))}
          aria-describedby={describe("currentPassword")}
          required
          autoFocus
        />
      </Field>
      <Field
        id="newPassword"
        label="New password"
        hint="At least 8 characters, with a letter and a number."
        error={fieldError("newPassword")}
      >
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          aria-invalid={Boolean(fieldError("newPassword"))}
          aria-describedby={describe("newPassword") ?? "newPassword-hint"}
          required
        />
      </Field>
      <Field
        id="confirmPassword"
        label="Repeat the new password"
        error={fieldError("confirmPassword")}
      >
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          aria-invalid={Boolean(fieldError("confirmPassword"))}
          aria-describedby={describe("confirmPassword")}
          required
        />
      </Field>
      <div className="flex items-start gap-3">
        <Checkbox
          id="signOutOtherDevices"
          name="signOutOtherDevices"
          defaultChecked
          className="mt-0.5"
        />
        <Label
          htmlFor="signOutOtherDevices"
          className="leading-snug font-normal text-muted-foreground"
        >
          Sign me out on my other phones and computers
        </Label>
      </div>

      {error && error.code !== "INTERNAL" && !hasFieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
        {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
        {pending ? "Saving" : "Save new password"}
      </Button>

      {error?.code === "INTERNAL" && error.errorId && (
        <ErrorDialog
          code={error.errorId}
          title="Your password was not changed"
          open={dismissedErrorId !== error.errorId}
          onClose={() => setDismissedErrorId(error.errorId)}
        />
      )}
    </form>
  );
}
