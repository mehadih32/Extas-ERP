import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { TermsAgreement } from "@/components/hr/terms-agreement";
import { TermsText } from "@/components/hr/terms-text";
import { formatDay } from "@/lib/display";
import { ROUTES, safeNextPath } from "@/lib/routes";
import { SIGN_METHOD_LABELS } from "@/modules/hr/terms";
import { getTermsGateAction } from "@/server/actions/terms.actions";
import { requireTermsPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Terms of employment" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

function Back({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      Back to the app
    </Link>
  );
}

/**
 * The terms of employment. Staff who must agree land here from every other
 * screen (server/pages/guards.ts) and read and agree; afterwards they go on to
 * the page they asked for. Anyone else reads the version in force, with when
 * they agreed to it.
 */
export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTermsPage();
  const next = safeNextPath(one((await searchParams).next)) ?? ROUTES.home;
  const result = await getTermsGateAction();
  if (!result.ok) {
    return (
      <SectionError
        title="Terms of employment"
        heading="The terms could not load"
        error={result.error}
      />
    );
  }
  const gate = result.data;
  if (gate?.due) return <TermsAgreement gate={gate} next={next} />;

  return (
    <div>
      <Back href={next} />
      <p className="eyebrow">Your company</p>
      <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
        Terms of employment
      </h1>
      {!gate ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The company has not published terms of employment yet.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Version {gate.version.version}
            {gate.version.publishedOn
              ? `, published ${formatDay(gate.version.publishedOn)}`
              : ""}.{" "}
            {gate.lastAgreed
              ? `You agreed to version ${gate.lastAgreed.version} on ${formatDay(gate.lastAgreed.signedOn)} (${SIGN_METHOD_LABELS[gate.lastAgreed.method].toLowerCase()}). Your signed copy is in My HR, My details.`
              : ""}
          </p>
          <TermsText text={gate.version} className="mt-8 rounded-lg border bg-card p-5 sm:p-8" />
        </>
      )}
    </div>
  );
}
