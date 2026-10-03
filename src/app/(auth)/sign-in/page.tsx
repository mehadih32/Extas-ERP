import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ROUTES, safeNextPath } from "@/lib/routes";
import { getCurrentSession } from "@/modules/auth/context";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const [current, { next }] = await Promise.all([getCurrentSession(), searchParams]);
  const destination = safeNextPath(next);
  if (current) {
    redirect(
      current.user.mustChangePassword ? ROUTES.changePassword : (destination ?? ROUTES.home),
    );
  }

  return (
    <>
      <p className="eyebrow">Welcome back</p>
      <h1 className="mt-3 font-serif text-4xl text-primary">Sign in</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Use the email address your administrator registered for you.
      </p>
      <SignInForm next={destination ?? undefined} />
    </>
  );
}
