import { ChevronRightIcon, LockIcon } from "lucide-react";
import Link from "next/link";

import type { HelpSection } from "@/modules/help/types";

import { guideCount, HELP_ICONS, helpHref, NOT_IN_ROLE } from "./labels";

/** The manual's parts as cards: icon, name, what it covers and how many guides. */
export function SectionCards({
  sections,
  label,
}: {
  sections: Array<{ section: HelpSection; open: boolean }>;
  /** What the list is, for screen readers. */
  label: string;
}) {
  return (
    <ul aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sections.map(({ section, open }) => {
        const Icon = HELP_ICONS[section.id] ?? ChevronRightIcon;
        return (
          <li key={section.id} className="grid">
            <Link
              href={helpHref.section(section.id)}
              className="group grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span className="row-span-3 inline-flex size-10 items-center justify-center rounded-md bg-secondary text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span lang="bn" className="font-medium text-primary">
                {section.title}
              </span>
              <span lang="bn" className="text-sm leading-relaxed text-muted-foreground">
                {section.description}
              </span>
              <span
                lang="bn"
                className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
              >
                {guideCount(section.articles.length)}
                {!open && (
                  <span className="inline-flex items-center gap-1">
                    <LockIcon className="size-3.5" aria-hidden />
                    {NOT_IN_ROLE}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
