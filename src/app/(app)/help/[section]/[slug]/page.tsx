import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  LightbulbIcon,
  LockIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HelpImageSlot } from "@/components/help/help-image";
import { bnDigits, helpHref, NOT_IN_ROLE } from "@/components/help/labels";
import { Button } from "@/components/ui/button";
import { articleLink, findHelpArticle } from "@/modules/help";
import { requireCompanyPage } from "@/server/pages/guards";

type Params = Promise<{ section: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { section, slug } = await params;
  const found = findHelpArticle(section, slug);
  return { title: found ? `${found.article.title} · Help Center` : "Help Center" };
}

/** One guide: what it is for, who can do it, and the steps with their screenshots. */
export default async function HelpArticlePage({ params }: { params: Params }) {
  const ctx = await requireCompanyPage();
  const permissions = [...ctx.permissions];
  const { section: sectionId, slug } = await params;
  const found = findHelpArticle(sectionId, slug);
  if (!found) notFound();
  const { section, article } = found;
  const link = articleLink(article, permissions);
  const index = section.articles.indexOf(article);
  const previous = section.articles[index - 1];
  const next = section.articles[index + 1];

  return (
    <article className="grid grid-cols-1 gap-8">
      <header className="grid gap-4">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <li>
              <Link href={helpHref.home()} className="hover:text-foreground">
                Help Center
              </Link>
            </li>
            <li aria-hidden>
              <ChevronRightIcon className="size-3.5" />
            </li>
            <li>
              <Link lang="bn" href={helpHref.section(section.id)} className="hover:text-foreground">
                {section.title}
              </Link>
            </li>
          </ol>
        </nav>
        <div className="grid gap-3">
          <h1
            lang="bn"
            className="font-serif text-[1.75rem] leading-tight text-primary sm:text-[2.25rem]"
          >
            {article.title}
          </h1>
          <p lang="bn" className="max-w-3xl text-[0.9375rem] leading-[1.8] text-muted-foreground">
            {article.summary}
          </p>
        </div>
        {article.who && (
          <p
            lang="bn"
            className="flex max-w-3xl items-start gap-2 text-sm leading-relaxed text-foreground/90"
          >
            <UserRoundCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">কারা পারবেন: </span>
              {article.who}
            </span>
          </p>
        )}
        {link ? (
          <Button asChild variant="outline" className="h-11 justify-self-start sm:h-9">
            <Link href={link}>
              <ExternalLinkIcon aria-hidden />
              Open this page
            </Link>
          </Button>
        ) : (
          article.routes.length > 0 && (
            <p
              lang="bn"
              className="inline-flex items-center gap-2 justify-self-start rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <LockIcon className="size-4 shrink-0" aria-hidden />
              {NOT_IN_ROLE}। দরকার হলে আপনার অ্যাডমিনকে বলুন।
            </p>
          )
        )}
      </header>

      <section aria-labelledby="steps-heading" className="grid gap-4">
        <h2 id="steps-heading" lang="bn" className="text-lg font-medium">
          ধাপে ধাপে
        </h2>
        <ol className="grid grid-cols-1 gap-4">
          {article.steps.map((step, i) => (
            <li key={i} className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  lang="bn"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
                >
                  {bnDigits(i + 1)}
                </span>
                <p lang="bn" className="min-w-0 pt-1 text-[0.9375rem] leading-[1.8]">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.text}
                </p>
              </div>
              {step.image && (
                <div className="sm:pl-11">
                  <HelpImageSlot image={step.image} />
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {article.tips && article.tips.length > 0 && (
        <section
          aria-labelledby="tips-heading"
          className="grid gap-3 rounded-lg border border-primary/20 bg-secondary/60 p-4 sm:p-5"
        >
          <h2
            id="tips-heading"
            lang="bn"
            className="flex items-center gap-2 font-medium text-primary"
          >
            <LightbulbIcon className="size-4" aria-hidden />
            জেনে রাখুন
          </h2>
          <ul lang="bn" className="grid list-disc gap-2 pl-5 text-[0.9375rem] leading-[1.8]">
            {article.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      )}

      {(previous || next) && (
        <nav aria-label="More guides" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {previous ? (
            <Link
              href={helpHref.article(section.id, previous.slug)}
              className="group grid gap-1 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowLeftIcon className="size-3.5" aria-hidden />
                <span lang="bn">আগের নির্দেশিকা</span>
              </span>
              <span lang="bn" className="font-medium text-primary">
                {previous.title}
              </span>
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {next && (
            <Link
              href={helpHref.article(section.id, next.slug)}
              className="group grid gap-1 rounded-lg border bg-card p-4 text-right transition-colors hover:border-primary/40"
            >
              <span className="inline-flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                <span lang="bn">পরের নির্দেশিকা</span>
                <ArrowRightIcon className="size-3.5" aria-hidden />
              </span>
              <span lang="bn" className="font-medium text-primary">
                {next.title}
              </span>
            </Link>
          )}
        </nav>
      )}

      <p lang="bn" className="text-sm text-muted-foreground">
        যা খুঁজছেন তা এখানে নেই?{" "}
        <Link href={helpHref.home()} className="text-primary underline-offset-4 hover:underline">
          সহায়তা কেন্দ্রে খুঁজুন
        </Link>
      </p>
    </article>
  );
}
