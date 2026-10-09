import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { VerifiedBadge } from "@/components/parties/badges";
import { BackLink } from "@/components/settings/back-link";
import { QuotationBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { salesHref } from "@/components/sales/labels";
import { SalesNoAccess } from "@/components/sales/no-access";
import { QuotationActions } from "@/components/sales/quotation-actions";
import { QuoteItems } from "@/components/sales/quote-items";
import { formatDay } from "@/lib/display";
import { getQuotationScreenAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Quotation" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One quotation (sales.view, like GET /api/sales/quotations/:id): the buyer,
 * items with their sizes, styling rules, totals, terms and custom fields. What
 * may be done comes with the screen from the same rules the quotation actions
 * use (screen.can).
 */
export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ quotationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCompanyPage();
  const [{ quotationId }, query] = await Promise.all([params, searchParams]);
  const result = await getQuotationScreenAction(quotationId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError title="Quotation" heading="The quotation could not load" error={result.error} />
    );
  }
  const screen = result.data;
  const { quotation: q } = screen;
  const notice =
    one(query.created) === "1"
      ? "The quotation was saved as a draft."
      : one(query.saved) === "1"
        ? "The changes were saved."
        : undefined;

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/sales/quotations">All quotations</BackLink>
        <RecordHeader
          eyebrow={`Quotation ${q.number} · ${formatDay(q.issuedOn)}`}
          title={
            <span className="inline-flex items-center gap-2">
              <span className="min-w-0 break-words">{q.buyer.name}</span>
              {q.buyer.isVerified && <VerifiedBadge className="size-6" />}
            </span>
          }
          badges={
            <>
              <QuotationBadge status={q.status} isExpired={q.isExpired} />
              <span className="text-sm text-muted-foreground">
                {q.validUntil ? `Valid until ${formatDay(q.validUntil)}` : "No end date"}
              </span>
            </>
          }
        />
        {q.proforma && (
          <FormAlert tone="note">
            Made into proforma invoice{" "}
            <Link
              href={salesHref.proforma(q.proforma.id)}
              className="font-medium underline underline-offset-4"
            >
              {q.proforma.number}
            </Link>
            .
          </FormAlert>
        )}
        {q.isExpired && (
          <FormAlert tone="note">
            Its validity ended on {formatDay(q.validUntil!)}. Edit it to give a new date before
            sending it again.
          </FormAlert>
        )}
        <QuotationActions key={q.id} screen={screen} notice={notice} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <QuoteItems
            items={q.items}
            currency={q.currency}
            totals={[
              { label: "Subtotal", amount: q.subtotal },
              { label: "Discount", amount: q.discount, minus: true, optional: true },
              { label: "Tax / VAT", amount: q.tax, optional: true },
              { label: "Total", amount: q.total, strong: true },
            ]}
          />
          {q.stylingRules.length > 0 && (
            <Panel title="Styling rules" id="rules-heading">
              <ul className="mt-4 grid gap-3">
                {q.stylingRules.map((rule) => (
                  <li key={rule.id} className="text-sm leading-relaxed">
                    {rule.area && <span className="eyebrow mr-2">{rule.area}</span>}
                    {rule.instruction}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {(q.terms || q.notes) && (
            <Panel title="Terms and notes" id="terms-heading">
              <dl className="mt-4 grid gap-4">
                {q.terms && (
                  <Fact label="Terms">
                    <span className="whitespace-pre-line">{q.terms}</span>
                  </Fact>
                )}
                {q.notes && (
                  <Fact label="Notes">
                    <span className="whitespace-pre-line">{q.notes}</span>
                  </Fact>
                )}
              </dl>
            </Panel>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel
            title="Buyer"
            id="buyer-heading"
            action={
              screen.can.openBuyer ? (
                <Link
                  href={salesHref.buyer(q.buyer.id)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Profile
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Account">{`${q.buyer.name} (${q.buyer.code})`}</Fact>
              <Fact label="Contact">
                {[q.buyer.contactPerson, q.buyer.phone, q.buyer.email]
                  .filter(Boolean)
                  .join(" · ") || "Not given"}
              </Fact>
              {q.buyer.address && (
                <Fact label="Address">
                  <span className="whitespace-pre-line">{q.buyer.address}</span>
                </Fact>
              )}
            </dl>
          </Panel>
          {q.customFields.length > 0 && (
            <Panel title="More details" id="fields-heading">
              <dl className="mt-4 grid grid-cols-2 gap-4">
                {q.customFields.map((f) => (
                  <Fact key={f.key} label={f.label}>
                    {f.value}
                  </Fact>
                ))}
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
