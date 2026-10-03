import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { ROUTES } from "@/lib/routes";
import { requireSessionPage } from "@/server/pages/guards";

import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const { user } = await requireSessionPage();
  const firstTime = user.mustChangePassword;

  return (
    <>
      {!firstTime && (
        <Link
          href={ROUTES.home}
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Back to the dashboard
        </Link>
      )}
      <p className="eyebrow">{firstTime ? "Welcome to Extras ERP" : "Your account"}</p>
      <h1 className="mt-3 font-serif text-4xl text-primary">
        {firstTime ? "Set your password" : "Change password"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {firstTime
          ? "You signed in with a temporary password. Choose your own to continue."
          : `Choose a new password for ${user.email}.`}
      </p>
      <ChangePasswordForm firstTime={firstTime} />
      {firstTime && (
        <div className="mt-6 text-center">
          <SignOutButton variant="link" size="sm" className="text-muted-foreground">
            Not you? Sign out
          </SignOutButton>
        </div>
      )}
    </>
  );
}
