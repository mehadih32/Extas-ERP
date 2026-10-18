import {
  ArrowRightCircleIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  InfoIcon,
  TargetIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { HelpPicture } from "@/modules/help/pictures";
import { whatPoints } from "@/modules/help/guide-text";
import type { HelpArticle, HelpField } from "@/modules/help/types";

/*
 * The parts of a guide around its steps: What it is, Why it matters, its
 * picture with the steps' numbers marked, every button and field and what it
 * means, what happens next, and common mistakes.
 */

function Part({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} lang="bn" className="flex items-center gap-2 text-lg font-medium">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

const PARAGRAPH = "max-w-3xl text-[0.9375rem] leading-[1.8] break-words";

/** "এটা কী" (What) and "কেন দরকার" (Why). */
export function GuideWhatWhy({ what, why }: { what?: HelpArticle["what"]; why?: string }) {
  if (!what && !why) return null;
  const points = whatPoints(what);
  return (
    <div className="grid gap-6">
      {what && (
        <Part
          id="what-heading"
          icon={<InfoIcon className="size-4 text-primary" aria-hidden />}
          title="এটা কী"
        >
          {/* Short points, so the reader takes in one part of the screen at a time. */}
          {points.length > 1 ? (
            <ul lang="bn" className={`${PARAGRAPH} grid list-disc gap-1.5 pl-5`}>
              {points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          ) : (
            <p lang="bn" className={PARAGRAPH}>
              {points[0]}
            </p>
          )}
        </Part>
      )}
      {why && (
        <Part
          id="why-heading"
          icon={<TargetIcon className="size-4 text-primary" aria-hidden />}
          title="কেন দরকার, কখন ব্যবহার করবেন"
        >
          <p lang="bn" className={PARAGRAPH}>
            {why}
          </p>
        </Part>
      )}
    </div>
  );
}

/** Every button, tab, field and option on the screen, and what it means. */
export function GuideFields({ fields }: { fields?: HelpField[] }) {
  if (!fields?.length) return null;
  return (
    <Part
      id="fields-heading"
      icon={<InfoIcon className="size-4 text-primary" aria-hidden />}
      title="প্রতিটা বোতাম আর ঘরের মানে"
    >
      <dl className="grid grid-cols-1 divide-y rounded-lg border bg-card">
        {fields.map((field) => (
          <div
            key={field.label}
            className="grid gap-1 p-3 sm:grid-cols-[minmax(10rem,16rem)_1fr] sm:gap-4 sm:p-4"
          >
            <dt className="min-w-0 font-medium break-words">{field.label}</dt>
            <dd lang="bn" className="min-w-0 text-[0.9375rem] leading-[1.8] break-words">
              {field.text}
            </dd>
          </div>
        ))}
      </dl>
    </Part>
  );
}

/** What happens next, and the common mistakes. */
export function GuideAfter({ next, mistakes }: { next?: string; mistakes?: string[] }) {
  return (
    <>
      {next && (
        <Part
          id="next-heading"
          icon={<ArrowRightCircleIcon className="size-4 text-primary" aria-hidden />}
          title="এরপর কী হয়"
        >
          <p lang="bn" className={PARAGRAPH}>
            {next}
          </p>
        </Part>
      )}
      {mistakes && mistakes.length > 0 && (
        <Part
          id="mistakes-heading"
          icon={<CircleAlertIcon className="size-4 text-destructive" aria-hidden />}
          title="সাধারণ ভুল"
        >
          <ul
            lang="bn"
            className="grid max-w-3xl list-disc gap-2 pl-5 text-[0.9375rem] leading-[1.8]"
          >
            {mistakes.map((mistake) => (
              <li key={mistake} className="break-words">
                {mistake}
              </li>
            ))}
          </ul>
        </Part>
      )}
    </>
  );
}

/** The guide's automatic picture, with a red numbered mark for each step it shows. */
export function GuidePicture({ picture, title }: { picture: HelpPicture; title: string }) {
  return (
    <figure className="grid gap-2">
      <a
        href={picture.src}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-md border bg-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed picture, served as it is */}
        <img
          src={picture.src}
          width={picture.width}
          height={picture.height}
          alt={`${title}: ছবিতে ধাপগুলোর নম্বর লাল দাগে দেখানো`}
          loading="lazy"
          className="h-auto w-full"
        />
      </a>
      <figcaption
        lang="bn"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <span>
          {picture.marks.length > 0
            ? "ছবির লাল নম্বরগুলো নিচের ধাপের নম্বর।"
            : "এই পাতাটি যেমন দেখায়।"}{" "}
          ডেমো সাইটের নমুনা ডেটা থেকে নিজে থেকে তোলা, {picture.taken}।
        </span>
        <a
          href={picture.src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          <ExternalLinkIcon className="size-3.5" aria-hidden />
          বড় করে দেখুন
        </a>
      </figcaption>
    </figure>
  );
}
