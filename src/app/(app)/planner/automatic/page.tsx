import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { RulesNoAccess } from "@/components/planner/no-access";
import { RuleCards } from "@/components/planner/rules";
import { getRulesScreenAction } from "@/server/actions/reminders.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Automatic reminders" };

/**
 * When the app reminds people about production deadlines, goods due in-house,
 * shipments, licence renewals and task due dates, and who hears about each:
 * readable with reminders.manage, changeable with company.settings.
 */
export default async function AutomaticRemindersPage() {
  await requireCompanyPage();
  const result = await getRulesScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <RulesNoAccess />;
    return (
      <SectionError
        title="Automatic reminders"
        heading="The automatic reminders could not load"
        error={result.error}
      />
    );
  }
  const { rules, can } = result.data;

  return (
    <section aria-labelledby="rules-heading" className="grid gap-6">
      <div>
        <h2 id="rules-heading" className="font-serif text-2xl text-primary">
          Automatic reminders
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          As a date comes near, the people who can act on it hear about it in the app, and again
          while it is overdue until it is dealt with.{" "}
          {can.edit
            ? "Change the days, the time and who hears about each kind."
            : "The owner sets the days, the time and who hears about each kind."}{" "}
          WhatsApp and email come later.
        </p>
      </div>
      <RuleCards rules={rules} canEdit={can.edit} />
    </section>
  );
}
