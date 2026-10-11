import type { Metadata } from "next";

import { MyDetailsForm, MyPapers, MyPayDetails } from "@/components/hr/my-details";
import { MyHrProblem } from "@/components/hr/no-access";
import { VaultChecklist } from "@/components/hr/vault-bits";
import { Panel } from "@/components/sales/detail-bits";
import { vaultScore } from "@/modules/hr/vault";
import { getMyProfileScreenAction } from "@/server/actions/portal.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "My details" };

/**
 * The employee's own data vault (portal.self): their details, filled once or
 * kept up to date, how they are paid (a change waits for HR), and their papers.
 * HR sees the same record.
 */
export default async function MyDetailsPage() {
  await requireCompanyPage();
  const result = await getMyProfileScreenAction();
  if (!result.ok) {
    return (
      <MyHrProblem error={result.error} title="My details" heading="Your details could not load" />
    );
  }
  const screen = result.data;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-6">
        <Panel title="My details" id="details-heading">
          <p className="mt-1 text-sm text-muted-foreground">
            {screen.details.name} · {screen.details.code}
          </p>
          <MyDetailsForm screen={screen} />
        </Panel>
      </div>

      <div className="grid min-w-0 grid-cols-1 content-start gap-6">
        <Panel
          title="My record"
          id="record-heading"
          action={
            <span
              className={`text-sm ${screen.gaps.length > 0 ? "text-destructive" : "text-muted-foreground"}`}
            >
              {vaultScore(screen.gaps)}
            </span>
          }
        >
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            {screen.gaps.length === 0
              ? "Your record has everything HR needs."
              : "Fill in what is missing, so HR has everything they need."}
          </p>
          <VaultChecklist gaps={screen.gaps} />
        </Panel>

        <Panel title="How I am paid" id="pay-heading">
          <MyPayDetails screen={screen} />
        </Panel>

        <Panel title="My papers" id="papers-heading">
          <MyPapers screen={screen} />
        </Panel>
      </div>
    </div>
  );
}
