import type { Metadata } from "next";

import { ProductionNoAccess } from "@/components/production/no-access";
import { SaveToTechPackForm } from "@/components/production/tech-pack/save-form";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Save to Tech Pack" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The first web link in a shared text, when the phone sends it there. */
const linkIn = (text: string) => text.match(/https?:\/\/\S+/i)?.[0] ?? "";

/**
 * Save to Tech Pack: a photo or a link shared from the phone's Share button
 * (or pasted here), saved with a note to a style's tech pack. Nothing is read
 * from the website itself. For production.manage.
 */
export default async function SaveToTechPackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("production.manage")) {
    return (
      <ProductionNoAccess title="Saving to a tech pack is not part of your role">
        Production Managers and merchandisers save references to a style. Your administrator can
        give your role that permission.
      </ProductionNoAccess>
    );
  }
  const q = await searchParams;
  const text = one(q.text);
  const url = one(q.url) || linkIn(text);
  const note = [one(q.title), text.replace(url, "").trim()]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
  const problem = one(q.problem);
  return (
    <div className="grid gap-6">
      <div>
        <p className="eyebrow">Production</p>
        <h2 className="mt-2 font-serif text-2xl text-primary">Save to Tech Pack</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          On your phone, open a photo or a product page, press Share and pick Extas ERP. It opens
          here with the photo and the link; pick the style, add a short note and save. The AI reads
          saved references when it drafts the tech pack. Nothing is copied from the website itself.
        </p>
      </div>
      <SaveToTechPackForm
        sharedFileId={one(q.file) || null}
        link={url}
        note={note}
        problem={
          problem === "size"
            ? "The photo is over 10 MB. Save a smaller one."
            : problem === "type"
              ? "Only a photo (JPG, PNG or WebP) can be saved from the Share button."
              : null
        }
      />
    </div>
  );
}
