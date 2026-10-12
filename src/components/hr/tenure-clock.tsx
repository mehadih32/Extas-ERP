"use client";

import { useEffect, useState } from "react";

import { formatDay } from "@/lib/display";

const two = (n: number) => String(n).padStart(2, "0");

/** "1st", "2nd", "3rd", "11th", "21st". */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen
    ? "th"
    : n % 10 === 1
      ? "st"
      : n % 10 === 2
        ? "nd"
        : n % 10 === 3
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

/**
 * How long someone has been with the company, ticking every second: the
 * years, months and days (worked out on the server in company time), and the
 * days, hours, minutes and seconds since the start of the join day. It stops
 * on the last working day of someone who has left.
 */
export function TenureClock({
  company,
  tenure,
}: {
  company: string;
  tenure: {
    /** The server's time when the page was made, so the first render matches. */
    at: string;
    joined: string;
    since: string;
    until: string | null;
    text: string;
    next: { date: string; years: number; inDays: number } | null;
  };
}) {
  const [at, setAt] = useState(() => Date.parse(tenure.at));
  useEffect(() => {
    if (tenure.until) return;
    const timer = setInterval(() => setAt(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tenure.until]);

  const end = tenure.until ? Date.parse(tenure.until) : at;
  const seconds = Math.max(0, Math.floor((end - Date.parse(tenure.since)) / 1000));
  const days = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const next = tenure.next;

  return (
    <div className="grid content-start gap-2">
      <p className="text-sm text-muted-foreground">With {company} for</p>
      <p className="font-serif text-2xl leading-tight text-primary sm:text-[1.75rem]">
        {tenure.text}
      </p>
      <p
        role="timer"
        aria-label={`${days} days with ${company}`}
        className="font-mono text-sm text-foreground tabular-nums"
      >
        {days.toLocaleString("en")} {days === 1 ? "day" : "days"} {two(h)} h {two(m)} m {two(s)} s
      </p>
      <p className="text-[0.8125rem] text-muted-foreground">
        Joined {formatDay(tenure.joined)}
        {next &&
          ` · ${ordinal(next.years)} work anniversary on ${formatDay(next.date)}${
            next.inDays === 1 ? ", tomorrow" : `, in ${next.inDays} days`
          }`}
      </p>
    </div>
  );
}
