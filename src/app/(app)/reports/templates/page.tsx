import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { TemplateBadges } from "@/components/reports/badges";
import { reportsHref } from "@/components/reports/labels";
import { TemplatesNoAccess } from "@/components/reports/no-access";
import { AddTemplateButton, WriteHtmlButton } from "@/components/reports/template-forms";
import { getTemplatesScreenAction } from "@/server/actions/templates.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Templates" };

const tags = (n: number) => `${n} tag${n === 1 ? "" : "s"}`;

/**
 * The company's own document designs (templates.manage), by the kind of
 * document they are for: upload a Word file, PDF, HTML page or picture of the
 * pad, or write an HTML page here, then open one to check or place its tags.
 */
export default async function TemplatesPage() {
  await requireCompanyPage();
  const result = await getTemplatesScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <TemplatesNoAccess />;
    return (
      <SectionError title="Templates" heading="The templates could not load" error={result.error} />
    );
  }
  const { types, groups } = result.data;

  return (
    <section aria-labelledby="templates-heading" className="grid grid-cols-1 gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="templates-heading" className="font-serif text-2xl text-primary">
            Templates
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Your own designs for quotations, proforma invoices, invoices, delivery challans and
            letters, with tags like {"{BuyerName}"} where the data goes. Without one, documents
            print on the standard design with your letterhead.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AddTemplateButton kinds={types} />
          <WriteHtmlButton kinds={types} />
        </div>
      </div>

      {groups.map((group) => (
        <section
          key={group.type}
          aria-labelledby={`templates-${group.type}`}
          className="grid grid-cols-1 gap-3"
        >
          <h3 id={`templates-${group.type}`} className="font-serif text-xl text-primary">
            {group.label}
          </h3>
          {group.templates.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground">
              {group.type === "LETTERHEAD"
                ? "No letter templates yet. Letters print on the blank letterhead."
                : "None yet. These print on the standard design."}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.templates.map((t) => (
                <li key={t.id} className="min-w-0">
                  <Link
                    href={reportsHref.template(t.id)}
                    className="group block h-full rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <TemplateBadges
                        format={t.format}
                        isDefault={t.isDefault}
                        isActive={t.isActive}
                      />
                    </div>
                    <p className="mt-2 font-serif text-lg leading-snug break-words text-primary">
                      {t.name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t.pages !== null
                        ? t.tags === 0
                          ? "No tags placed yet"
                          : `${tags(t.tags)} placed`
                        : t.tags === 0
                          ? "No tags found in it"
                          : tags(t.tags)}
                      {t.unmapped > 0 && (
                        <span className="text-destructive">
                          {" · "}
                          {t.unmapped} print nothing yet
                        </span>
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </section>
  );
}
