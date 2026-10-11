import { paragraphsOf, type TermsText as Text } from "@/modules/hr/terms";

/**
 * The terms of employment as staff read them: the title, the opening note and
 * each section with its paragraphs, in Bengali and English as HR wrote them.
 */
export function TermsText({
  text,
  headingLevel = "h2",
  className,
}: {
  text: Text;
  /** h2 on the terms screen, h4 inside a panel. */
  headingLevel?: "h2" | "h4";
  className?: string;
}) {
  const Title = headingLevel;
  const Section = headingLevel === "h2" ? "h3" : "h5";
  return (
    <article className={className}>
      <Title className="font-serif text-2xl leading-snug text-primary">{text.title}</Title>
      {paragraphsOf(text.intro).map((p, i) => (
        <p key={i} className="mt-3 text-[0.9375rem] leading-relaxed">
          {p}
        </p>
      ))}
      <div className="mt-6 grid gap-7">
        {text.sections.map((section, i) => (
          <section key={i} className="min-w-0">
            <Section className="text-base font-semibold text-primary">{section.title}</Section>
            {paragraphsOf(section.body).map((p, j) => (
              <p key={j} className="mt-2.5 text-[0.9375rem] leading-relaxed break-words">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
