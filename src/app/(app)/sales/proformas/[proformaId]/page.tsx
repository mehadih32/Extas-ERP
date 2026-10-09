import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { ProformaBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader, Totals } from "@/components/sales/detail-bits";
import { STAGE_LABELS } from "@/components/production/labels";
import { isZero, money, salesHref } from "@/components/sales/labels";
import { MoneyRecords } from "@/components/sales/money-records";
import { SalesNoAccess } from "@/components/sales/no-access";
import { ProformaActions } from "@/components/sales/proforma-actions";
import { QuoteItems } from "@/components/sales/quote-items";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { getProformaScreenAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Proforma invoice" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One proforma invoice (sales.view, like GET /api/sales/proformas/:id): the
 * quotation's items, the advance asked for and paid, the production it started
 * and the order it became. What may be done comes with the screen from the same
 * rules the proforma, payment and refund actions use (screen.can).
 */
export default async function ProformaPage({
  params,
  searchParams,
}: {
  params: Promise<{ proformaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ proformaId }, query] = await Promise.all([params, searchParams]);
  const result = await getProformaScreenAction(proformaId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Proforma invoice"
        heading="The proforma invoice could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const { proforma: p, notes } = screen;
  const currency = ctx.company.currency;
  const notice =
    one(query.created) === "1"
      ? `The proforma invoice was made. Once the ${money(p.advanceAmount, currency)} advance is paid in full, production starts.`
      : undefined;
  const closed = p.status === "CANCELLED" || p.status === "CONVERTED";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/sales/proformas">All proformas</BackLink>
        <RecordHeader
          eyebrow={`Proforma invoice ${p.number} · ${formatDay(p.issuedOn)}`}
          title={p.buyer.name}
          badges={
            <>
              <ProformaBadge status={p.status} />
              {p.quotation && (
                <span className="text-sm text-muted-foreground">
                  From quotation{" "}
                  <Link
                    href={salesHref.quotation(p.quotation.id)}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {p.quotation.number}
                  </Link>
                </span>
              )}
            </>
          }
        />
        {p.order && (
          <FormAlert tone="note">
            It became order{" "}
            <Link
              href={salesHref.order(p.order.id)}
              className="font-medium underline underline-offset-4"
            >
              {p.order.number}
            </Link>
            ; the advance paid moved onto the order.
          </FormAlert>
        )}
        {notes.convert && <FormAlert tone="note">{notes.convert}</FormAlert>}
        {notes.cancel && <FormAlert tone="note">{notes.cancel}</FormAlert>}
        <ProformaActions
          key={p.id}
          screen={screen}
          currency={currency}
          today={localDay(new Date(), ctx.company.timezone)}
          notice={notice}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          {p.items.length > 0 ? (
            <QuoteItems
              items={p.items}
              currency={currency}
              totals={[{ label: "Total", amount: p.total, strong: true }]}
            />
          ) : (
            <Panel title="Items" id="items-heading">
              <p className="mt-4 text-sm text-muted-foreground">
                It was made without a quotation, for {money(p.total, currency)}.
              </p>
            </Panel>
          )}
          {p.stylingRules.length > 0 && (
            <Panel title="Styling rules" id="rules-heading">
              <ul className="mt-4 grid gap-3">
                {p.stylingRules.map((rule) => (
                  <li key={rule.id} className="text-sm leading-relaxed">
                    {rule.area && <span className="eyebrow mr-2">{rule.area}</span>}
                    {rule.instruction}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <MoneyRecords
            payments={p.payments}
            refunds={p.refunds}
            currency={currency}
            empty="No advance was paid yet."
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Panel title="Advance" id="advance-heading">
            <Totals
              className="mt-4"
              currency={currency}
              lines={[
                { label: "Total", amount: p.total },
                { label: `Advance asked (${p.advancePercent}%)`, amount: p.advanceAmount },
                { label: "Advance paid", amount: p.advancePaid },
                ...(closed
                  ? []
                  : [
                      {
                        label: "Advance still due",
                        amount: p.advanceDue,
                        strong: true,
                        tone: "due" as const,
                      },
                    ]),
                ...(!closed && !isZero(screen.held) && screen.held !== p.advancePaid
                  ? [{ label: "Held after refunds", amount: screen.held, tone: "muted" as const }]
                  : []),
              ]}
            />
            {!closed && (
              <p className="mt-3 text-[0.8125rem] text-muted-foreground">
                {money(p.balanceDue, currency)} is left to pay on the full total.
              </p>
            )}
          </Panel>
          {p.production.length > 0 && (
            <Panel title="Production" id="production-heading">
              <ul className="mt-4 grid gap-3">
                {p.production.map((project) => (
                  <li key={project.id} className="min-w-0 text-sm">
                    <p className="font-medium break-words">
                      {project.code} · {project.name}
                    </p>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {STAGE_LABELS[project.stage]}
                      {project.targetOn ? ` · due ${formatDay(project.targetOn)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel
            title="Buyer"
            id="buyer-heading"
            action={
              screen.can.openBuyer ? (
                <Link
                  href={salesHref.buyer(p.buyer.id)}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Profile
                </Link>
              ) : undefined
            }
          >
            <dl className="mt-4 grid gap-4">
              <Fact label="Account">{`${p.buyer.name} (${p.buyer.code})`}</Fact>
              <Fact label="Contact">
                {[p.buyer.contactPerson, p.buyer.phone].filter(Boolean).join(" · ") || "Not given"}
              </Fact>
              {p.buyer.address && (
                <Fact label="Address">
                  <span className="whitespace-pre-line">{p.buyer.address}</span>
                </Fact>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
