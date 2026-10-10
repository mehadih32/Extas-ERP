import type { Metadata } from "next";

import { HelpSearch } from "@/components/help/help-search";
import { SectionCards } from "@/components/help/section-cards";
import { roleLabel } from "@/components/shell/labels";
import { localDay } from "@/lib/dates";
import { HELP_SECTIONS, helpSearchEntries, sectionOpen } from "@/modules/help";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Help Center" };

/**
 * The Help Center: the manual in Bengali, part by part, with a search box that
 * answers as people type. Everyone may read every guide; guides about pages a
 * person's role does not open say so.
 */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const permissions = [...ctx.permissions];
  const q = (await searchParams).q;
  const initialQuery = typeof q === "string" ? q.slice(0, 200) : "";
  const parts = HELP_SECTIONS.map((section) => ({
    section,
    open: sectionOpen(section, permissions),
  }));
  const mine = parts.filter((p) => p.open);
  const others = parts.filter((p) => !p.open);

  return (
    <div className="grid grid-cols-1 gap-8">
      <header className="grid gap-3">
        <p className="eyebrow">Help Center</p>
        <h1
          lang="bn"
          className="font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]"
        >
          সহায়তা কেন্দ্র
        </h1>
        <p lang="bn" className="max-w-2xl text-[0.9375rem] leading-[1.8] text-muted-foreground">
          Extas ERP-এর প্রতিটি অংশ কীভাবে ব্যবহার করবেন, ধাপে ধাপে সহজ বাংলায়। নিচে খুঁজুন, অথবা
          একটি বিভাগ খুলুন।
        </p>
      </header>
      <HelpSearch
        entries={helpSearchEntries(permissions)}
        initialQuery={initialQuery}
        roleName={roleLabel(ctx.role, ctx.user.isSuperAdmin)}
        companyName={ctx.company.name}
        today={localDay(new Date(), ctx.company.timezone)}
      >
        <div className="grid gap-8">
          <section aria-labelledby="help-mine" className="grid gap-3">
            <h2 id="help-mine" lang="bn" className="font-serif text-xl text-primary">
              আপনার কাজের নির্দেশিকা
            </h2>
            <SectionCards sections={mine} label="Your parts of the app" />
          </section>
          {others.length > 0 && (
            <section aria-labelledby="help-others" className="grid gap-3">
              <div>
                <h2 id="help-others" lang="bn" className="font-serif text-xl text-primary">
                  অন্যান্য বিভাগ
                </h2>
                <p lang="bn" className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  এই অংশগুলো আপনার ভূমিকায় খোলা নেই। পড়তে পারবেন; কাজ করতে হলে অ্যাডমিনকে বলুন।
                </p>
              </div>
              <SectionCards sections={others} label="Other parts of the app" />
            </section>
          )}
        </div>
      </HelpSearch>
    </div>
  );
}
