import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { TemplateBadges } from "@/components/reports/badges";
import { fileSize, reportsHref, TEMPLATE_FORMAT_LABELS } from "@/components/reports/labels";
import { TemplatesNoAccess } from "@/components/reports/no-access";
import { TemplateActions } from "@/components/reports/template-actions";
import { TagCatalog } from "@/components/reports/tag-catalog";
import { TagMapping } from "@/components/reports/tag-mapping";
import { TagPlacement } from "@/components/reports/tag-placement";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { BackLink } from "@/components/settings/back-link";
import { formatDay } from "@/lib/format";
import { localDay } from "@/lib/dates";
import { getTemplateScreenAction } from "@/server/actions/templates.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Template" };

/**
 * One of the company's own designs (templates.manage): try it on the newest
 * record of its kind, check what each tag prints (Word and HTML) or place the
 * tags on the page (PDF and pictures), and change, switch off or delete it.
 */
export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ templateId }, query] = await Promise.all([params, searchParams]);
  const result = await getTemplateScreenAction(templateId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <TemplatesNoAccess />;
    return (
      <SectionError title="Template" heading="The template could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { template: t, catalog, filled, sample } = screen;
  const overlay = t.format === "PDF" || t.format === "IMAGE";
  const tagKey = t.placeholders.map((p) => p.tag).join(",");

  return (
    <div className="grid grid-cols-1 gap-6">
      <BackLink href={reportsHref.templates}>All templates</BackLink>
      <RecordHeader
        eyebrow={`${t.documentLabel} template`}
        title={t.name}
        badges={<TemplateBadges format={t.format} isDefault={t.isDefault} isActive={t.isActive} />}
      />
      {query.added === "1" && (
        <FormAlert tone="success">
          The template is saved.{" "}
          {overlay
            ? "Now click the page below where each piece of data should print."
            : t.unmapped.length > 0
              ? "Some tags were not recognised: pick what they print below."
              : "Every tag was recognised. Try it to see the result."}
        </FormAlert>
      )}
      <TemplateActions key={t.id} screen={screen} />
      {!sample && (
        <p className="text-sm text-muted-foreground">
          There is no {t.documentLabel.toLowerCase()} to try it on yet.
        </p>
      )}

      <Panel title={overlay ? "Where the tags print" : "What the tags print"} id="tags-heading">
        {!overlay && t.unmapped.length > 0 && (
          <div className="mt-4">
            <FormAlert tone="note">
              {t.unmapped.length === 1 ? "One tag prints" : `${t.unmapped.length} tags print`}{" "}
              nothing yet: {t.unmapped.join(", ")}. Pick what each one prints, or leave it empty.
            </FormAlert>
          </div>
        )}
        {overlay ? (
          <TagPlacement key={t.id} template={t} catalog={catalog} />
        ) : (
          <TagMapping
            key={tagKey}
            templateId={t.id}
            placeholders={t.placeholders}
            catalog={catalog}
          />
        )}
      </Panel>

      {!overlay && (
        <Panel title="Tags you can use" id="catalog-heading">
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Type these in your {t.format === "WORD" ? "Word file" : "page"} where the data goes,
            then {t.format === "WORD" ? "replace the file" : "save the page"}. Tags with other names
            can be given their data above.
          </p>
          <TagCatalog catalog={catalog} />
        </Panel>
      )}

      <Panel title="About this template" id="template-facts-heading">
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Kind">{TEMPLATE_FORMAT_LABELS[t.format]}</Fact>
          <Fact label="For">{t.documentLabel}</Fact>
          <Fact label="File">
            {t.source.fileName}
            <span className="text-muted-foreground"> · {fileSize(t.source.sizeBytes)}</span>
          </Fact>
          {t.pages && (
            <Fact label="Pages">{t.pages.length === 1 ? "1 page" : `${t.pages.length} pages`}</Fact>
          )}
          <Fact label="Documents filled from it">{filled}</Fact>
          <Fact label="Last changed">{formatDay(localDay(t.updatedAt, ctx.company.timezone))}</Fact>
        </dl>
      </Panel>
    </div>
  );
}
