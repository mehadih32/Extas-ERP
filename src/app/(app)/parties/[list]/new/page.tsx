import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { PartiesNoAccess } from "@/components/parties/no-access";
import { PartyForm } from "@/components/parties/party-form";
import { listName } from "@/components/parties/route";
import { BackLink } from "@/components/settings/back-link";
import { getPartyFormAction } from "@/server/actions/parties.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ list: string }>;
}): Promise<Metadata> {
  const { list } = await params;
  return { title: list === "suppliers" ? "New supplier" : "New buyer" };
}

/** A new buyer or supplier: for parties.manage, the permission createPartyAction checks. */
export default async function NewPartyPage({ params }: { params: Promise<{ list: string }> }) {
  const ctx = await requireCompanyPage();
  const name = listName((await params).list);
  if (!name) notFound();
  const noun = name === "buyers" ? "buyer" : "supplier";
  if (!ctx.can("parties.manage")) {
    return (
      <PartiesNoAccess title={`Adding ${name} is not part of your role`}>
        Your administrator can give your role the permission to manage buyers and suppliers.
      </PartiesNoAccess>
    );
  }
  const result = await getPartyFormAction();
  if (!result.ok) {
    return (
      <SectionError title={`New ${noun}`} heading="The form could not load" error={result.error} />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href={`/parties/${name}`}>All {name}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">New {noun}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Only the name is needed now; the rest can be filled in later.
          {name === "buyers" ? " Counter and online sales can go without a buyer profile." : ""}
        </p>
      </div>
      <PartyForm form={result.data} list={name} currency={ctx.company.currency} />
    </div>
  );
}
