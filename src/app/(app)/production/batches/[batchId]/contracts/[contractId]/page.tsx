import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { quantity } from "@/components/materials/labels";
import { ContractForm } from "@/components/production/contract-form";
import { ContractActions } from "@/components/production/contracts";
import { CONTRACT_KIND_LABELS, productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { BackLink } from "@/components/settings/back-link";
import { StatusBadge } from "@/components/sales/badges";
import { Fact, Panel, RecordHeader } from "@/components/sales/detail-bits";
import { money } from "@/components/sales/labels";
import { formatDay } from "@/lib/display";
import type { ContractScreen } from "@/modules/production/contract.service";
import { getContractScreenAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Contract" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
const linkClass = "text-primary underline-offset-4 hover:underline";

/** What the contract covers now: the supplier's goods for the batch, or the factory's styles. */
function Covers({ data, currency }: { data: ContractScreen; currency: string }) {
  if (data.goods) {
    const { rows, ordered } = data.goods;
    return (
      <Panel title="What is bought" id="covers-heading">
        <p className="mt-1 text-sm text-muted-foreground">
          {ordered
            ? "The lines on this supplier's purchase orders for the batch, as they are now."
            : "Nothing is ordered from this supplier for the batch yet: these are what the styles still need."}
        </p>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing of this kind is ordered from them or needed by the styles yet.
          </p>
        ) : (
          <ul className="mt-4 grid divide-y" aria-label="Goods">
            {rows.map((r, i) => (
              <li key={i} className="grid min-w-0 gap-0.5 py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium break-words">
                  {r.material.code} · {r.material.name}
                </p>
                <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
                  {quantity(r.quantity, r.material.unit, currency)} ·{" "}
                  {r.unitPrice
                    ? `${money(r.unitPrice, currency)} each, ${money(r.amount!, currency)}`
                    : ordered
                      ? "price at receive"
                      : "price to agree"}
                  {r.order ? ` · ${r.order}` : ""}
                  {r.expectedOn ? ` · by ${formatDay(r.expectedOn)}` : ""}
                </p>
                {r.material.details && (
                  <p className="text-[0.8125rem] break-words text-muted-foreground">
                    {r.material.details}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }
  const styles = data.styles ?? [];
  const cm = data.cm!;
  return (
    <Panel title="What is made" id="covers-heading">
      <ul className="mt-4 grid divide-y" aria-label="Styles">
        {styles.map((s) => (
          <li key={s.id} className="grid min-w-0 gap-0.5 py-3 first:pt-0 last:pb-0">
            <Link
              href={productionHref.project(s.id)}
              className={`text-sm font-medium ${linkClass}`}
            >
              {s.code} · {s.name}
            </Link>
            <p className="text-[0.8125rem] text-muted-foreground tabular-nums">
              {s.pieces.toLocaleString("en-US")} pcs ·{" "}
              {s.cmAmount
                ? `CM ${money(s.cmAmount, currency)} a ${s.cmPer === "DOZEN" ? "dozen" : "piece"}, ${money(s.totalCm!, currency)}`
                : "CM to agree"}{" "}
              · by {formatDay(s.dueOn)}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t pt-3 text-sm font-medium tabular-nums">
        Total CM: {cm.toAgree === styles.length ? "to agree" : money(cm.total, currency)}
        {cm.toAgree > 0 && cm.toAgree < styles.length ? ` (${cm.toAgree} still to agree)` : ""}
      </p>
    </Panel>
  );
}

/**
 * A batch's fabric, accessories or factory (CM) agreement (production.manage or
 * accounts.view, like GET /api/production/contracts/:id): what it covers now,
 * its clauses to review and change (Production Managers), the signed day and
 * the PDF to print for signing.
 */
export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string; contractId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ batchId, contractId }, query] = await Promise.all([params, searchParams]);
  const result = await getContractScreenAction(contractId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Contracts are not part of your role">
          Contracts carry prices and CM, so Production Managers and Accounts see them. Your
          administrator can give your role that permission.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError title="Contract" heading="The contract could not load" error={result.error} />
    );
  }
  const data = result.data;
  if (data.batch.id !== batchId) notFound();
  const c = data.contract;
  const currency = ctx.company.currency;
  const notice =
    one(query.drafted) === "1"
      ? `${c.number} was drafted from the batch. Read each clause, change what you need, save it and print it for signing.`
      : one(query.saved) === "1"
        ? "The contract was saved."
        : undefined;
  const partyLabel = c.kind === "FACTORY_CM" ? "Factory" : "Supplier";

  return (
    <div className="grid grid-cols-1 gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={productionHref.batch(data.batch.id)}>
          {data.batch.code} · {data.batch.name}
        </BackLink>
        <RecordHeader
          eyebrow={`${c.number} · ${CONTRACT_KIND_LABELS[c.kind]}`}
          title={`${c.title} with ${c.party.name}`}
          badges={
            c.signedOn ? (
              <StatusBadge tone="done">Signed {formatDay(c.signedOn)}</StatusBadge>
            ) : (
              <StatusBadge tone="open">Draft</StatusBadge>
            )
          }
        />
        <ContractActions
          contract={c}
          batchId={data.batch.id}
          canDelete={data.can.edit && !c.signedOn}
          notice={notice}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="grid min-w-0 content-start gap-6">
          {data.can.edit ? (
            <ContractForm data={data} currency={currency} />
          ) : (
            <Panel title="Terms" id="terms-heading">
              <ol className="mt-4 grid gap-4" aria-label="Clauses">
                {c.clauses.map((cl, i) => (
                  <li key={i} className="grid gap-1">
                    <p className="text-sm font-medium">
                      {i + 1}. {cl.title}
                    </p>
                    <p className="text-sm leading-relaxed break-words whitespace-pre-line text-muted-foreground">
                      {cl.text}
                    </p>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-6">
          <Covers data={data} currency={currency} />
          <Panel title="Details" id="details-heading">
            <dl className="mt-4 grid gap-4">
              <Fact label={partyLabel}>
                {ctx.can("parties.view") ? (
                  <Link href={productionHref.supplier(c.party.id)} className={linkClass}>
                    {c.party.name}
                  </Link>
                ) : (
                  c.party.name
                )}
                {c.party.phone && (
                  <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                    {c.party.phone}
                  </span>
                )}
              </Fact>
              <Fact label="Master batch">
                <Link href={productionHref.batch(data.batch.id)} className={linkClass}>
                  {data.batch.code}
                </Link>
              </Fact>
              <div className="grid grid-cols-2 gap-4">
                <Fact label="Drafted">
                  {formatDay(c.draftedOn)}
                  {c.draftedBy && (
                    <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                      {c.draftedBy}
                    </span>
                  )}
                </Fact>
                <Fact label="Last changed">
                  {formatDay(c.changedOn)}
                  {c.changedBy && (
                    <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                      {c.changedBy}
                    </span>
                  )}
                </Fact>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
