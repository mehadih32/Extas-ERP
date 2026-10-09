import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { partyHref } from "@/components/parties/labels";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { PartyForm } from "@/components/parties/party-form";
import { listName } from "@/components/parties/route";
import { BackLink } from "@/components/settings/back-link";
import { getPartyFormAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Edit details" };

/** A buyer's or supplier's details: for parties.manage, the permission updatePartyAction checks. */
export default async function EditPartyPage({
  params,
}: {
  params: Promise<{ list: string; partyId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { list, partyId } = await params;
  const name = listName(list);
  if (!name) notFound();
  if (!ctx.can("parties.manage")) {
    return (
      <PartiesNoAccess title="Changing buyers and suppliers is not part of your role">
        Your administrator can give your role the permission to manage buyers and suppliers.
      </PartiesNoAccess>
    );
  }
  const result = await getPartyFormAction(partyId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <SectionError title="Edit details" heading="The form could not load" error={result.error} />
    );
  }
  const party = result.data.party!;

  return (
    <div className="grid gap-6">
      <BackLink href={partyHref(party)}>{party.name}</BackLink>
      <div>
        <p className="eyebrow">{party.code}</p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Edit details</h2>
        {party.isWalkIn && (
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Walk-in customers is kept by the system, so only its name and notes can change.
          </p>
        )}
      </div>
      <PartyForm form={result.data} list={name} currency={ctx.company.currency} />
    </div>
  );
}
