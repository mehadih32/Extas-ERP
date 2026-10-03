import { redirect } from "next/navigation";

import { visibleSettingsTabs } from "@/components/settings/tabs";
import { requireCompanyPage } from "@/server/pages/guards";

/** Settings opens on the first tab this person may see (the company details for everyone). */
export default async function SettingsPage() {
  const ctx = await requireCompanyPage();
  redirect(visibleSettingsTabs(ctx.permissions)[0]!.href);
}
