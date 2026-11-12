import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { LeadActions, LeadContacts, LeadFiles, LeadSamples } from "@/components/leads/lead-actions";
import { SalesNoAccess } from "@/components/sales/no-access";
import { BackLink } from "@/components/settings/back-link";
import { Badge } from "@/components/ui/badge";
import { formatDay, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_LABELS,
  CATEGORY_LABELS,
  NEXT_KIND_LABELS,
  PAYMENT_LABELS,
  STAGE_LABELS,
} from "@/modules/leads/labels";
import { getLeadAction } from "@/server/actions/leads.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Lead" };

const DOT = {
  green: "bg-emerald-600",
  yellow: "bg-amber-500",
  red: "bg-destructive",
} as const;

const COLOUR_WORDS = { green: "Green", yellow: "Yellow", red: "Red" } as const;

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
    <section
      aria-labelledby={id}
      className={cn("grid content-start gap-3 rounded-md border p-4", className)}
    >
      <h3 id={id} className="font-serif text-lg text-primary">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Lead 360: the company, its check card, next step, contacts, its history
 * (added to only), samples, files and, once it is a buyer, the link to Buyer 360.
 */
export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const ctx = await requireCompanyPage();
  const { leadId } = await params;
  const result = await getLeadAction(leadId);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return <SectionError title="Lead" heading="The lead could not load" error={result.error} />;
  }
  const lead = result.data;
  const money = (v: string | null) =>
    v ? `${lead.currency} ${groupAmount(v, lead.currency)}` : "—";

  return (
    <div className="grid gap-6">
      <BackLink href="/sales/leads">All leads</BackLink>
      <header className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="min-w-0 font-serif text-2xl break-words text-primary">{lead.name}</h2>
          <Badge variant={lead.stage === "LOST" ? "alert" : "secondary"} className="normal-case">
            {STAGE_LABELS[lead.stage]}
          </Badge>
          {lead.archived && (
            <Badge variant="outline" className="normal-case">
              Archived
            </Badge>
          )}
        </div>
        <p className="text-sm break-words text-muted-foreground">
          {[
            lead.number,
            CATEGORY_LABELS[lead.category],
            [lead.city, lead.country].filter(Boolean).join(", "),
            lead.website,
            `Added ${formatDay(lead.createdOn)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {lead.buyer && (
          <p className="text-sm">
            Now a buyer:{" "}
            <Link
              href={`/parties/buyers/${encodeURIComponent(lead.buyer.id)}`}
              className="font-medium text-primary hover:underline"
            >
              {lead.buyer.code} {lead.buyer.name}
            </Link>
            {lead.convertedOn ? ` (since ${formatDay(lead.convertedOn)})` : ""}
          </p>
        )}
        {lead.doNotContact && (
          <p className="text-sm text-destructive">Nobody at this company is to be contacted.</p>
        )}
        <LeadActions lead={lead} />
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Next step" id="lead-next">
          {lead.nextActionOn ? (
            <p className={cn("text-sm", lead.late && "text-destructive")}>
              {lead.nextActionKind ? NEXT_KIND_LABELS[lead.nextActionKind] : "Follow up"} on{" "}
              {formatDay(lead.nextActionOn)}
              {lead.late ? " (late)" : ""}
              {lead.nextActionNote ? `: ${lead.nextActionNote}` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No next step set.</p>
          )}
          <dl className="grid gap-1 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Followed by:</dt>
              <dd>{lead.owner?.name ?? "Nobody yet"}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Source:</dt>
              <dd className="break-words">
                {lead.source?.name ?? "Not set"}
                {lead.sourceNote ? ` · ${lead.sourceNote}` : ""}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Products:</dt>
              <dd className="break-words">{lead.products.join(", ") || "—"}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Pieces per style:</dt>
              <dd>{lead.piecesPerStyle ?? "—"}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Their price per piece:</dt>
              <dd className="tabular-nums">{money(lead.targetPrice)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Expected value:</dt>
              <dd className="tabular-nums">{money(lead.expectedValue)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Payment:</dt>
              <dd>{lead.paymentTerms ? PAYMENT_LABELS[lead.paymentTerms] : "Not known yet"}</dd>
            </div>
            {lead.lostReason && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Why lost:</dt>
                <dd className="break-words">{lead.lostReason}</dd>
              </div>
            )}
          </dl>
        </Panel>

        <Panel title="Lead check" id="lead-check">
          <p className="text-[0.8125rem] text-muted-foreground">
            From your rules in Lead settings. It decides nothing: you do.
          </p>
          <ul className="grid gap-2">
            {lead.check.map((c) => (
              <li key={c.key} className="flex items-start gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[c.colour])}
                />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{c.label}</span>{" "}
                  <span className="sr-only">({COLOUR_WORDS[c.colour]})</span>
                  <span className="text-muted-foreground">{c.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Contacts" id="lead-contacts">
          <LeadContacts lead={lead} me={ctx.user.name} />
        </Panel>

        <Panel title="Samples" id="lead-samples">
          <LeadSamples lead={lead} />
        </Panel>

        <Panel title="History" id="lead-history" className="lg:col-span-2">
          <p className="text-[0.8125rem] text-muted-foreground">
            Every call, email, meeting and change, newest first. Nobody can change or delete a line;
            to correct one, log a new note.
          </p>
          <ol className="grid gap-3">
            {lead.activities.map((a) => (
              <li key={a.id} className="grid gap-0.5 border-l-2 pl-3 text-sm">
                <p className="text-[0.8125rem] text-muted-foreground">
                  {formatDay(a.on)} · {ACTIVITY_LABELS[a.kind]}
                  {a.contact ? ` · ${a.contact}` : ""}
                  {a.by ? ` · by ${a.by}` : ""}
                </p>
                <p className="break-words">{a.summary}</p>
                {a.body && (
                  <p className="text-[0.8125rem] break-words whitespace-pre-line text-muted-foreground">
                    {a.body}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Files" id="lead-files" className="lg:col-span-2">
          <LeadFiles lead={lead} />
        </Panel>
      </div>
    </div>
  );
}
