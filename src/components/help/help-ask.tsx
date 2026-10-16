"use client";

import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/forms/field";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AiMonthCost } from "@/modules/ai/costs.service";
import type { HelpAi, HelpAnswer } from "@/modules/ai/help-ai.service";
import { askHelpAction } from "@/server/actions/ai.actions";

import { helpHref } from "./labels";

/** Today's and this month's AI cost, for the people who see the AI Center. */
function CostLine({ cost }: { cost: AiMonthCost }) {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
      <span>
        AI cost today:{" "}
        <span className="font-medium text-foreground tabular-nums">
          {money(cost.today.spent, cost.currency)}
        </span>
      </span>
      <span>
        This month:{" "}
        <span className="font-medium text-foreground tabular-nums">
          {money(cost.spent, cost.currency)}
        </span>
      </span>
      <Link href="/ai/costs?period=today" className="underline underline-offset-4">
        Budget & Costs
      </Link>
    </p>
  );
}

/**
 * Help Center > "Ask the Help AI": a question in Bengali or English, answered
 * from the manual's guides (named under the answer). Only while AI is on.
 */
export function HelpAsk({ helpAi }: { helpAi: HelpAi }) {
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<HelpAnswer>();
  const [error, setError] = useState<string>();
  const cost = answer?.cost ?? helpAi.cost;

  const ask = () => {
    if (question.trim().length < 3) return;
    startTransition(async () => {
      const result = await askHelpAction({ question });
      if (result.ok) {
        setAnswer(result.data);
        setError(undefined);
      } else setError(result.error.message);
    });
  };

  return (
    <section
      aria-labelledby="help-ask-heading"
      className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="grid gap-1">
        <h2
          id="help-ask-heading"
          className="flex items-center gap-2 font-serif text-xl text-primary"
        >
          <SparklesIcon aria-hidden className="size-5" />
          Ask the Help AI
        </h2>
        <p lang="bn" className="text-sm leading-relaxed text-muted-foreground">
          {helpAi.on
            ? "আপনার প্রশ্ন বাংলায় বা ইংরেজিতে লিখুন। এআই এই নির্দেশিকাগুলো পড়ে উত্তর দেবে, আর কোন নির্দেশিকা পড়েছে তা দেখাবে। সে শুধু বুঝিয়ে দেয়, ERP-তে কিছু বদলায় না।"
            : "এআই এখন বন্ধ, তাই Help AI উত্তর দেবে না। নিচের খোঁজার ঘরে লিখে নির্দেশিকা খুঁজুন।"}
        </p>
      </div>
      {helpAi.on && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <label htmlFor="help-ask-question" className="sr-only">
            Your question
          </label>
          <Textarea
            id="help-ask-question"
            lang="bn"
            rows={2}
            maxLength={500}
            value={question}
            placeholder="নতুন বায়ার কীভাবে যোগ করব?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || question.trim().length < 3}>
              <SparklesIcon aria-hidden />
              {pending ? "Asking" : "Ask"}
            </Button>
          </div>
        </form>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      {answer && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
          <p lang="bn" className="text-sm leading-relaxed whitespace-pre-wrap">
            {answer.answer}
          </p>
          {answer.guides.length > 0 && (
            <div className="grid gap-1 text-[0.8125rem]">
              <p className="text-muted-foreground">Guides it read:</p>
              <ul className="grid gap-0.5">
                {answer.guides.map((g) => (
                  <li key={`${g.section}/${g.slug}`}>
                    <Link
                      lang="bn"
                      href={helpHref.article(g.section, g.slug)}
                      className="underline underline-offset-4"
                    >
                      {g.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {cost && <CostLine cost={cost} />}
    </section>
  );
}
