"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { ErrorDialog } from "@/components/feedback/error-dialog";
import { Field, FormAlert } from "@/components/forms/field";
import { PasswordInput } from "@/components/forms/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInFormAction } from "@/server/actions/auth-forms.actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signInFormAction, null);
  const [dismissedErrorId, setDismissedErrorId] = useState<string>();
  const error = state?.error;
  const fieldError = (name: string) => error?.fieldErrors?.[name]?.[0];
  const hasFieldErrors = Boolean(fieldError("email") || fieldError("password"));

  return (
    <form action={formAction} className="mt-8 grid gap-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="email" label="Email" error={fieldError("email")}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={state?.email}
          aria-invalid={Boolean(fieldError("email"))}
          aria-describedby={fieldError("email") ? "email-error" : undefined}
          required
          autoFocus
        />
      </Field>
      <Field id="password" label="Password" error={fieldError("password")}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          aria-invalid={Boolean(fieldError("password"))}
          aria-describedby={fieldError("password") ? "password-error" : undefined}
          required
        />
      </Field>

      {error && error.code !== "INTERNAL" && !hasFieldErrors && (
        <FormAlert>{error.message}</FormAlert>
      )}

      <Button
        type="submit"
        size="lg"
        className="mt-1 w-full tracking-[0.08em] uppercase"
        disabled={pending}
      >
        {pending && <LoaderCircleIcon className="animate-spin" aria-hidden />}
        {pending ? "Signing in" : "Sign in"}
      </Button>
      <p className="text-center text-[0.8125rem] leading-relaxed text-muted-foreground">
        Forgot your password? Ask your administrator to set a temporary one.
      </p>

      {error?.code === "INTERNAL" && error.errorId && (
        <ErrorDialog
          code={error.errorId}
          title="We could not sign you in"
          open={dismissedErrorId !== error.errorId}
          onClose={() => setDismissedErrorId(error.errorId)}
        />
      )}
    </form>
  );
}
