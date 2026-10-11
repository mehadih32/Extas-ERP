import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { hrHref } from "@/components/hr/labels";
import { HrNoAccess } from "@/components/hr/no-access";
import { StartTermsDraft, TermsEditor, TermsStaffList } from "@/components/hr/terms-hr";
import { TermsText } from "@/components/hr/terms-text";
import { Panel } from "@/components/sales/detail-bits";
import { formatDay } from "@/lib/display";
import { getTermsScreenAction } from "@/server/actions/terms.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Terms of employment" };

const linkClass = "text-primary underline-offset-4 hover:underline";
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
const count = (n: number, word: string) => `${n} ${word}`;

/**
 * The terms of employment staff agree to before they use the app: the version
 * in force, the draft of the next one (HR, hr.manage), earlier versions, and
 * who has agreed, with each signed copy. Everyone with HR access reads it.
 */
export default async function HrTermsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const result = await getTermsScreenAction({ version: one((await searchParams).version) });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <HrNoAccess />;
    return (
      <SectionError
        title="Terms of employment"
        heading="The terms could not load"
        error={result.error}
      />
    );
  }
  const s = result.data;
  const v = s.published;
  const nextVersion = (v?.version ?? 0) + 1;

  return (
    <section aria-labelledby="terms-heading" className="grid gap-6">
      <div>
        <h2 id="terms-heading" className="font-serif text-2xl text-primary">
          Terms of employment
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          What staff read to the end and agree to, by signature or SMS code, before they use the
          app. Each change is a new version; you choose whether everyone agrees again. A signed copy
          of each agreement goes in the person&apos;s papers.
          {!s.can.edit && " Only HR can change them."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {s.draft && s.can.edit && (
            <Panel title={`Draft of version ${nextVersion}`} id="draft-heading">
              <p className="mt-1 text-sm text-muted-foreground">
                Staff do not see the draft. Publish it when it reads right
                {v ? "" : "; have a lawyer check it first"}.
              </p>
              <TermsEditor key={s.draft.id} draft={s.draft} first={!v} />
            </Panel>
          )}

          {v ? (
            <Panel
              title={`Version ${v.version} in force`}
              id="published-heading"
              action={
                !s.draft && s.can.edit ? (
                  <StartTermsDraft label={`Start version ${nextVersion}`} />
                ) : undefined
              }
            >
              <p className="mt-1 text-sm text-muted-foreground">
                Published {v.publishedOn ? formatDay(v.publishedOn) : ""}
                {v.publishedBy ? ` by ${v.publishedBy.name}` : ""} ·{" "}
                {v.askEveryone
                  ? "everyone agrees to it"
                  : "only staff who had never agreed were asked"}
              </p>
              <TermsText text={v} headingLevel="h4" className="mt-6" />
              <p className="mt-6 border-t pt-4 font-mono text-[0.75rem] break-all text-muted-foreground">
                Fingerprint: {v.textHash}
              </p>
            </Panel>
          ) : (
            !s.draft && (
              <Panel title="No terms yet" id="none-heading">
                <p className="mt-2 text-sm leading-relaxed">
                  Staff are not asked to agree to anything until you publish the first version.
                  Start from the starter text, in Bengali and English: confidentiality, zero
                  tolerance for theft, deductions from salary and leaving the company. Change it as
                  you need, and have a lawyer check it before you publish.
                </p>
                {s.can.edit && (
                  <div className="mt-4">
                    <StartTermsDraft label="Start from the starter text" />
                  </div>
                )}
              </Panel>
            )
          )}

          {s.viewing && (
            <Panel title={`Version ${s.viewing.version}, earlier`} id="earlier-text-heading">
              <p className="mt-1 text-sm text-muted-foreground">
                Published {s.viewing.publishedOn ? formatDay(s.viewing.publishedOn) : ""}
                {s.viewing.publishedBy ? ` by ${s.viewing.publishedBy.name}` : ""}.{" "}
                <Link href={hrHref.terms()} className={linkClass}>
                  Close
                </Link>
              </p>
              <TermsText text={s.viewing} headingLevel="h4" className="mt-6" />
            </Panel>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Who has agreed" id="agreed-heading">
            {v && (
              <p className="mt-1 text-sm text-muted-foreground">
                {count(s.staff.agreed, "agreed")} · {count(s.staff.toAgree, "to agree")}
                {s.staff.noLogin > 0 ? ` · ${count(s.staff.noLogin, "without a login")}` : ""}
              </p>
            )}
            {!v && (
              <p className="mt-1 text-sm text-muted-foreground">
                Nobody is asked yet: no terms are published.
              </p>
            )}
            <TermsStaffList staff={s.staff} canEdit={s.can.edit} />
          </Panel>

          {s.earlier.length > 0 && (
            <Panel title="Earlier versions" id="earlier-heading">
              <ul className="mt-4 grid divide-y" aria-label="Earlier versions">
                {s.earlier.map((e) => (
                  <li key={e.id} className="py-3 text-sm first:pt-0 last:pb-0">
                    <Link
                      href={`${hrHref.terms(e.version)}#earlier-text-heading`}
                      className={linkClass}
                    >
                      Version {e.version}
                    </Link>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      Published {formatDay(e.publishedOn)}
                      {e.publishedBy ? ` by ${e.publishedBy.name}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}
