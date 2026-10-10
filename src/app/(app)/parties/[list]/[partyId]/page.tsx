import { BanknoteIcon, MailIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { PrintDocumentButton } from "@/components/documents/print-button";
import { FormAlert } from "@/components/forms/field";
import { GradeBadge, StatusBadge, VerifiedBadge } from "@/components/parties/badges";
import { BuyerFigures, BuyerHistoryPanels, BuyerTopStyles } from "@/components/parties/buyer-360";
import { accountsHref } from "@/components/accounts/labels";
import { EmailPendingButton } from "@/components/parties/email-pending";
import {
  balanceText,
  balanceTone,
  kindLabel,
  listOf,
  money,
  partyHref,
  STATUS_MEANINGS,
  SUPPLIER_CATEGORIES,
  SUPPLIER_CATEGORY_LABELS,
} from "@/components/parties/labels";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { PartyActions } from "@/components/parties/party-actions";
import { listName } from "@/components/parties/route";
import { SupplierFigures, SupplierPanels } from "@/components/parties/supplier-360";
import { BackLink } from "@/components/settings/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount, formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import { BUYER_HISTORIES, type BuyerHistory } from "@/modules/parties/buyer-360.service";
import type { PartyScreen } from "@/modules/parties/screens.service";
import { SUPPLIER_HISTORIES, type SupplierHistory } from "@/modules/parties/supplier-360.service";
import {
  getBuyer360Action,
  getPartyScreenAction,
  getSupplier360Action,
} from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Buyer or supplier" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const historyFrom = (value: string | undefined): BuyerHistory | undefined =>
  BUYER_HISTORIES.find((h) => h === value);

const supplierListFrom = (value: string | undefined): SupplierHistory | undefined =>
  SUPPLIER_HISTORIES.find((h) => h === value);

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

function Panel({
  title,
  id,
  children,
  className,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("rounded-lg border bg-card p-5 sm:p-6", className)}>
      <h3 id={id} className="font-serif text-xl text-primary">
        {title}
      </h3>
      {children}
    </section>
  );
}

function daysAgo(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function MoneyPanel({ screen, currency }: { screen: PartyScreen; currency: string }) {
  const { money: m, party } = screen;
  const sells = party.kind !== "SUPPLIER";
  const tone = balanceTone(m.balance);
  return (
    <Panel title="Balance" id="balance-heading">
      <p
        className={cn(
          "mt-3 font-serif text-[1.75rem] leading-tight lining-nums tabular-nums",
          tone === "owed" && "text-primary",
          tone === "owing" && "text-destructive",
          tone === "settled" && "text-muted-foreground",
        )}
      >
        {balanceText(m.balance, currency)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {tone === "owed"
          ? `What ${party.name} owes you today.`
          : tone === "owing"
            ? party.kind === "BUYER"
              ? `What you owe ${party.name} today, such as an advance they paid.`
              : `What you owe ${party.name} today.`
            : "Nothing is owed either way today."}
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5">
        {sells && (
          <Fact label="Credit limit">
            {m.creditLimit ? money(m.creditLimit, currency) : "No limit"}
          </Fact>
        )}
        {sells && m.creditAvailable !== null && (
          <Fact label="Credit left">
            <span
              className={cn(
                "tabular-nums",
                m.creditAvailable.startsWith("-") && "text-destructive",
              )}
            >
              {m.creditAvailable.startsWith("-")
                ? `Over by ${money(m.creditAvailable, currency)}`
                : money(m.creditAvailable, currency)}
            </span>
          </Fact>
        )}
        <Fact label="Payment terms">
          {m.paymentTermsDays === null
            ? "Not set"
            : m.paymentTermsDays === 0
              ? "On delivery"
              : `${m.paymentTermsDays} days`}
        </Fact>
        <Fact label="Last payment">
          {m.lastPayment ? (
            <span className="tabular-nums">
              {money(m.lastPayment.amount, currency)}{" "}
              {m.lastPayment.direction === "RECEIVED" ? "received" : "paid"} on{" "}
              {formatDay(m.lastPayment.on)}
            </span>
          ) : (
            "None yet"
          )}
        </Fact>
        <Fact label="Last business">
          {screen.lastTransactionOn
            ? `${formatDay(screen.lastTransactionOn)} (${daysAgo(screen.daysInactive)})`
            : "None yet"}
        </Fact>
        {/[1-9]/.test(m.openingBalance) && (
          <Fact label="Opening balance">
            <span className="tabular-nums">
              {money(m.openingBalance, currency)}{" "}
              {m.openingBalance.startsWith("-") ? "owed to them" : "owed to you"}
            </span>
          </Fact>
        )}
      </dl>
    </Panel>
  );
}

function ContactPanel({ screen }: { screen: PartyScreen }) {
  const { party } = screen;
  const linkClass =
    "inline-flex items-center gap-1.5 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/25";
  const place = [party.city, party.country].filter(Boolean).join(", ");
  return (
    <Panel title="Contact" id="contact-heading">
      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Fact label="Contact person">{party.contactPerson ?? "Not given"}</Fact>
        <Fact label="Phone">
          {party.phone ? (
            <a href={`tel:${party.phone.replace(/[^+\d]/g, "")}`} className={linkClass}>
              <PhoneIcon className="size-3.5" aria-hidden />
              {party.phone}
            </a>
          ) : (
            "Not given"
          )}
        </Fact>
        <Fact label="WhatsApp">
          {screen.whatsappDigits ? (
            <a
              href={`https://wa.me/${screen.whatsappDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              <MessageCircleIcon className="size-3.5" aria-hidden />
              {party.whatsapp ?? party.phone}
            </a>
          ) : (
            "Not given"
          )}
        </Fact>
        <Fact label="Email">
          {party.email ? (
            <a href={`mailto:${party.email}`} className={linkClass}>
              <MailIcon className="size-3.5" aria-hidden />
              <span className="break-all">{party.email}</span>
            </a>
          ) : (
            "Not given"
          )}
        </Fact>
        <Fact label="Address">
          {party.address || place ? (
            <span className="whitespace-pre-line">
              {[party.address, place].filter(Boolean).join("\n")}
            </span>
          ) : (
            "Not given"
          )}
        </Fact>
        <Fact label="Tax ID (BIN / TIN)">{party.taxId ?? "Not given"}</Fact>
      </dl>
    </Panel>
  );
}

function ActivityPanel({ screen, currency }: { screen: PartyScreen; currency: string }) {
  const { party, counts } = screen;
  const sells = party.kind !== "SUPPLIER";
  const buys = party.kind !== "BUYER";
  const figures: Array<[string, number]> = [
    ...(sells
      ? ([
          ["Quotations", counts.quotations],
          ["Orders", counts.orders],
          ["Invoices", counts.invoices],
          ["Production for them", counts.productionsAsBuyer],
        ] as Array<[string, number]>)
      : []),
    ...(buys
      ? ([
          ["Supplier bills", counts.supplierBills],
          ["Production at their factory", counts.productionsAsFactory],
        ] as Array<[string, number]>)
      : []),
  ];
  return (
    <Panel title="Business so far" id="activity-heading">
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt className="eyebrow">{label}</dt>
            <dd className="mt-1 font-serif text-lg leading-tight lining-nums tabular-nums">
              {formatCount(value, currency)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 border-t pt-4 text-[0.8125rem] text-muted-foreground">
        Added on {formatDay(party.addedOn)}
        {party.isVerified && party.verifiedOn && ` · Verified on ${formatDay(party.verifiedOn)}`}
      </p>
    </Panel>
  );
}

/**
 * One buyer's or supplier's profile (parties.view, like GET /api/parties/:id):
 * grade, Blue Verified badge and status, the balance with the credit left,
 * contact details and the business done so far. What may be changed comes with
 * the screen from the same rules the party actions use (screen.can).
 *
 * A buyer's profile is their Customer 360° view (GET /api/parties/:id/buyer-360):
 * total sales, the average order, outstanding and overdue, gross profit, the
 * styles they buy most and their whole history, with a PDF of all of it.
 * A supplier's is their Supplier 360° view (GET /api/parties/:id/supplier-360):
 * what is due to them, their active and completed projects with each one's
 * balance and settlement, the goods they delivered, and their purchase orders,
 * bills and payments, with a PDF too. Each part shows only to the people who
 * may see it (parties/profile-access.ts).
 */
export default async function PartyPage({
  params,
  searchParams,
}: {
  params: Promise<{ list: string; partyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ list, partyId }, query] = await Promise.all([params, searchParams]);
  const name = listName(list);
  if (!name) notFound();
  const result = await getPartyScreenAction(partyId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") return <PartiesNoAccess />;
    return (
      <SectionError
        title="Buyer or supplier"
        heading="The profile could not load"
        error={result.error}
      />
    );
  }
  const screen = result.data;
  const { party } = screen;
  // A supplier opened from the buyers' address (or the other way) moves to its own list.
  if (party.kind !== "BOTH" && listOf(party.kind) !== name) redirect(partyHref(party));
  const currency = ctx.company.currency;
  const open = historyFrom(one(query.show));
  const openList = supplierListFrom(one(query.show));
  // Customer 360°: buyers (and accounts that are both), seen from the buyers' list;
  // Supplier 360°: suppliers (and accounts that are both), seen from the suppliers' list.
  const [buyer, supplier] = await Promise.all([
    name === "buyers" ? getBuyer360Action(party.id, { all: open }) : null,
    name === "suppliers" ? getSupplier360Action(party.id, { all: openList }) : null,
  ]);
  const buyer360 = buyer?.ok ? buyer.data : null;
  const supplier360 = supplier?.ok ? supplier.data : null;
  const categories =
    party.kind === "BUYER"
      ? []
      : SUPPLIER_CATEGORIES.filter((c) => party.supplierCategories.includes(c));
  const noun =
    party.kind === "SUPPLIER" ? "supplier" : party.kind === "BUYER" ? "buyer" : "account";
  const notice =
    one(query.created) === "1"
      ? `The ${noun} was added.`
      : one(query.saved) === "1"
        ? "The details were saved."
        : undefined;

  return (
    <div className="grid gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href={`/parties/${name}`}>All {name}</BackLink>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">
              {party.code} · {kindLabel(party)}
            </span>
            {party.isWalkIn && (
              <Badge variant="outline" className="text-muted-foreground">
                System
              </Badge>
            )}
          </div>
          <h2 className="mt-2 flex items-center gap-2 font-serif text-[1.75rem] leading-tight text-primary">
            <span className="min-w-0 break-words">{party.name}</span>
            {party.isVerified && <VerifiedBadge className="size-6" />}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {party.grade ? (
              <GradeBadge grade={party.grade} />
            ) : (
              !party.isWalkIn && (
                <Badge variant="outline" className="text-muted-foreground">
                  No grade
                </Badge>
              )
            )}
            {party.isVerified && <VerifiedBadge full />}
            <StatusBadge status={party.status} showActive />
          </div>
          {categories.length > 0 && (
            <ul aria-label="What they supply" className="mt-2 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <li key={c}>
                  <Badge variant="secondary">{SUPPLIER_CATEGORY_LABELS[c]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        {party.isWalkIn ? (
          <FormAlert tone="note">
            Kept by the system: every sale without a buyer profile (counter sales, and website or
            social orders taken by name) is booked here. Only its name and notes can change.
          </FormAlert>
        ) : (
          party.status !== "ACTIVE" && (
            <FormAlert tone="note">
              {STATUS_MEANINGS[party.status]}
              {party.statusChangedOn && ` Since ${formatDay(party.statusChangedOn)}.`}
            </FormAlert>
          )
        )}
        <PartyActions key={party.id} screen={screen} currency={currency} notice={notice}>
          {buyer360?.can.print && (
            <div className="flex gap-2">
              <PrintDocumentButton
                request={{ type: "BUYER_360", partyId: party.id }}
                label="360° PDF"
                className="flex-1 sm:flex-none"
                ready={{
                  eyebrow: "Buyer profile",
                  description: `${party.name}'s whole history with the figures you may see, as of today.`,
                  errorTitle: "The PDF could not be made",
                }}
              />
              <EmailPendingButton
                what={`${party.name}'s 360° profile`}
                className="flex-1 sm:flex-none"
              />
            </div>
          )}
          {supplier360?.can.pay && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={accountsHref.pay(party.id)}>
                <BanknoteIcon aria-hidden />
                Pay supplier
              </Link>
            </Button>
          )}
          {supplier360?.can.print && (
            <div className="flex gap-2">
              <PrintDocumentButton
                request={{ type: "SUPPLIER_360", partyId: party.id }}
                label="360° PDF"
                className="flex-1 sm:flex-none"
                ready={{
                  eyebrow: "Supplier profile",
                  description: `${party.name}'s projects, deliveries and dues with the figures you may see, as of today.`,
                  errorTitle: "The PDF could not be made",
                }}
              />
              <EmailPendingButton
                what={`${party.name}'s 360° profile`}
                className="flex-1 sm:flex-none"
              />
            </div>
          )}
        </PartyActions>
      </div>

      {screen.possibleDuplicates.length > 0 && (
        <FormAlert tone="note">
          Same phone or email as{" "}
          {screen.possibleDuplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <Link
                href={partyHref(d)}
                className="font-medium underline underline-offset-4"
              >{`${d.name} (${d.code})`}</Link>
            </span>
          ))}
          . Check it is not the same {noun} added twice.
        </FormAlert>
      )}

      {buyer && !buyer.ok && (
        <SectionError
          title="Customer 360°"
          heading="The buyer's figures and history could not load"
          error={buyer.error}
        />
      )}
      {buyer360 && <BuyerFigures data={buyer360} currency={currency} />}
      {supplier && !supplier.ok && (
        <SectionError
          title="Supplier 360°"
          heading="The supplier's projects and history could not load"
          error={supplier.error}
        />
      )}
      {supplier360 && <SupplierFigures data={supplier360} currency={currency} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid content-start gap-6">
          <MoneyPanel screen={screen} currency={currency} />
          {buyer360 && <BuyerTopStyles data={buyer360} currency={currency} />}
        </div>
        <div className="grid content-start gap-6">
          <ContactPanel screen={screen} />
          <ActivityPanel screen={screen} currency={currency} />
        </div>
      </div>

      {buyer360 && (
        <BuyerHistoryPanels
          data={buyer360}
          currency={currency}
          open={open}
          basePath={partyHref(party)}
        />
      )}
      {supplier360 && (
        <SupplierPanels
          data={supplier360}
          currency={currency}
          open={openList}
          basePath={partyHref(party)}
        />
      )}

      {party.notes && (
        <Panel title="Notes" id="notes-heading">
          <p className="mt-3 max-w-3xl text-sm leading-relaxed whitespace-pre-line">
            {party.notes}
          </p>
        </Panel>
      )}
    </div>
  );
}
