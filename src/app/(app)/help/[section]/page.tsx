import { ArrowLeftIcon, ChevronRightIcon, LockIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { guideCount, HELP_ICONS, helpHref, NOT_IN_ROLE } from "@/components/help/labels";
import { articleOpen, findHelpSection, sectionOpen } from "@/modules/help";
import { requireCompanyPage } from "@/server/pages/guards";

type Params = Promise<{ section: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const section = findHelpSection((await params).section);
  return { title: section ? `${section.title} · Help Center` : "Help Center" };
}

/** One part of the manual: its guides, each opening step by step. */
export default async function HelpSectionPage({ params }: { params: Params }) {
  const ctx = await requireCompanyPage();
  const permissions = [...ctx.permissions];
  const section = findHelpSection((await params).section);
  if (!section) notFound();
  const Icon = HELP_ICONS[section.id] ?? ChevronRightIcon;
  const open = sectionOpen(section, permissions);

  return (
    <div className="grid grid-cols-1 gap-8">
      <header className="grid gap-4">
        <Link
          href={helpHref.home()}
          className="inline-flex items-center gap-2 justify-self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Help Center
        </Link>
        <div className="flex items-start gap-4">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="grid min-w-0 gap-2">
            <h1
              lang="bn"
              className="font-serif text-[1.75rem] leading-tight text-primary sm:text-[2.25rem]"
            >
              {section.title}
            </h1>
            <p lang="bn" className="max-w-2xl text-[0.9375rem] leading-[1.8] text-muted-foreground">
              {section.description}
            </p>
            <p lang="bn" className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              {guideCount(section.articles.length)}
              {!open && (
                <span className="inline-flex items-center gap-1">
                  <LockIcon className="size-3.5" aria-hidden />
                  {NOT_IN_ROLE}
                </span>
              )}
            </p>
          </div>
        </div>
      </header>
      <ol aria-label="Guides" className="grid grid-cols-1 gap-2">
        {section.articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={helpHref.article(section.id, article.slug)}
              className="group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span lang="bn" className="grid min-w-0 flex-1 gap-1">
                <span className="font-medium text-primary">{article.title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {article.summary}
                </span>
                {open && !articleOpen(article, permissions) && (
                  <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <LockIcon className="size-3.5" aria-hidden />
                    {NOT_IN_ROLE}
                  </span>
                )}
              </span>
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
