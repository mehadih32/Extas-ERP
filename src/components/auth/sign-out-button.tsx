"use client";

import { useState, useTransition } from "react";

import { ActionErrorDialog } from "@/components/feedback/action-error-dialog";
import { Button } from "@/components/ui/button";
import type { ActionError } from "@/lib/result";
import { signOutAction } from "@/server/actions/auth-forms.actions";

/** Ends this device's session and returns to the sign-in screen. */
export function SignOutButton({
  children = "Sign out",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "type">) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError>();

  return (
    <>
      <Button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => setError(await signOutAction()))}
        {...props}
      >
        {children}
      </Button>
      <ActionErrorDialog
        error={error}
        title="You are still signed in"
        onClose={() => setError(undefined)}
      />
    </>
  );
}
