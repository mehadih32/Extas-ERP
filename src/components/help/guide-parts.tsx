import { ArrowRightCircleIcon, CircleAlertIcon, InfoIcon, TargetIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { HelpField } from "@/modules/help/types";

/*
 * The parts of a guide around its steps: What it is, Why it matters, every
 * button and field and what it means, what happens next, and common mistakes.
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
export function GuideWhatWhy({ what, why }: { what?: string; why?: string }) {
  if (!what && !why) return null;
  return (
    <div className="grid gap-6">
      {what && (
        <Part
          id="what-heading"
          icon={<InfoIcon className="size-4 text-primary" aria-hidden />}
          title="এটা কী"
        >
          <p lang="bn" className={PARAGRAPH}>
            {what}
          </p>
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
