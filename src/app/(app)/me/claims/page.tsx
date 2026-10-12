import type { Metadata } from "next";

import { Stat } from "@/components/accounts/stat";
import { FlagBadge } from "@/components/hr/badges";
import { NewClaim, WithdrawClaim } from "@/components/hr/claim-actions";
import { CLAIM_KIND_LABELS, claimTitle, MY_CLAIM_STATE_LABELS } from "@/components/hr/claim-labels";
import { hrHref } from "@/components/hr/labels";
import { MyHrProblem } from "@/components/hr/no-access";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import type { Tone } from "@/components/sales/badges";
import { formatDay } from "@/lib/display";
import type { MyClaimState } from "@/modules/hr/claims.service";
import { getMyClaimsAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My claims" };

const smallText = "text-[0.8125rem] text-muted-foreground";
const linkClass = "text-primary underline-offset-4 hover:underline";

const STATE_TONES: Record<MyClaimState, Tone> = {
  WAITING: "warn",
  OWED: "open",
  PAID: "done",
  CANCELLED: "closed",
  REJECTED: "closed",
  WITHDRAWN: "plain",
};

/**
 * The employee's own claims (portal.self): trip fares and local material
 * bought for a production project, paid out of their own pocket. They send a
 * claim with a receipt photo, see where each one stands, and withdraw one
 * still waiting. The checks Accounts sees (GPS trail, usual price) are not
 * shown here.
 */
export default async function MyClaimsPage() {
  const ctx = await requireCompanyPage();
  const result = await getMyClaimsAction();
  if (!result.ok) {
    return (
      <MyHrProblem error={result.error} title="My claims" heading="Your claims could not load" />
    );
  }
  const s = result.data;
  const currency = ctx.company.currency;

  return (
    <section aria-labelledby="my-claims-heading" className="grid gap-6">
      <div>
        <h2 id="my-claims-heading" className="font-serif text-2xl text-primary">
          Claims
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Money you paid yourself for the company: a rickshaw or CNG fare for work, or local
          material (yarn, buttons) bought for a production project. Accounts checks each claim and
          pays you back.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:max-w-xl">
        <Stat
          label="To be paid to you"
          value={money(s.owed.amount, currency)}
          hint={
            s.owed.count > 0
              ? `${s.owed.count} approved ${s.owed.count === 1 ? "claim" : "claims"}`
              : "Nothing owed now"
          }
        />
        <Stat
          label="Waiting for Accounts"
          value={String(s.waiting.count)}
          hint={s.waiting.count > 0 ? money(s.waiting.amount, currency) : "Nothing waiting"}
        />
      </dl>

      <NewClaim
        today={s.today}
        projects={s.projects}
        places={s.places}
        recentRoutes={s.recentRoutes}
      />

      {s.claims.length === 0 ? (
        <EmptyState title="No claims yet">
          Use “New claim” for a fare you paid for a work trip, or for local material you bought for
          a production project. Keep the receipt or memo and add its photo.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="Your claims">
          {s.claims.map((c) => {
            const changed =
              c.approvedAmount !== null && c.approvedAmount !== c.amount ? c.approvedAmount : null;
            return (
              <li key={c.id} className="grid min-w-0 gap-2 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="eyebrow block">
                      {c.number} · {CLAIM_KIND_LABELS[c.kind]} · {formatDay(c.date)}
                    </span>
                    <span className="mt-1 block font-medium break-words">{claimTitle(c)}</span>
                  </span>
                  <FlagBadge tone={STATE_TONES[c.state]}>
                    {MY_CLAIM_STATE_LABELS[c.state]}
                  </FlagBadge>
                </div>
                <p className="font-serif text-xl text-primary tabular-nums">
                  {changed ? (
                    <>
                      {money(changed, currency)}{" "}
                      <span className={`font-sans ${smallText} line-through`}>
                        {money(c.amount, currency)}
                      </span>
                    </>
                  ) : (
                    money(c.amount, currency)
                  )}
                </p>
                {c.kind === "CONVEYANCE"
                  ? c.purpose && <p className={smallText}>{c.purpose}</p>
                  : c.project && (
                      <p className={smallText}>
                        For {c.project.code} {c.project.name}
                        {c.shop ? ` · from ${c.shop}` : ""}
                        {c.purpose ? ` · ${c.purpose}` : ""}
                      </p>
                    )}
                {c.state === "PAID" && c.paidAt && (
                  <p className="text-sm">Paid back on {formatDay(c.paidAt)}.</p>
                )}
                {c.state === "CANCELLED" && (
                  <p className="text-sm">
                    Accounts approved it, then cancelled it. Ask Accounts if you think this is
                    wrong.
                  </p>
                )}
                {c.reason && (c.state === "REJECTED" || changed) && (
                  <p className="text-sm">
                    <span className="font-medium">
                      {c.state === "REJECTED" ? "Why not:" : "Why it changed:"}
                    </span>{" "}
                    {c.reason}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {c.receipt ? (
                    <a href={hrHref.file(c.receipt.id)} className={`text-sm ${linkClass}`}>
                      Receipt: {c.receipt.fileName}
                    </a>
                  ) : (
                    <span className={smallText}>No receipt photo</span>
                  )}
                  {c.canWithdraw && (
                    <WithdrawClaim id={c.id} what={`${c.number}, ${money(c.amount, currency)}`} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
