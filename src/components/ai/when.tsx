"use client";

import { createContext, useContext } from "react";

/*
 * Times on the AI Center's screens, in the company's time zone (the AI layout
 * gives it), so the page the server draws and the page the browser draws read
 * the same, wherever the server runs.
 */

const TimeZone = createContext<string | undefined>(undefined);

export function AiTimeZone({
  timeZone,
  children,
}: {
  timeZone: string;
  children: React.ReactNode;
}) {
  return <TimeZone value={timeZone}>{children}</TimeZone>;
}

type At = Date | string | null | undefined;

/** "16 Oct, 04:19", or "16 Oct 2026, 04:19" with the year; "" with no time. */
export function useWhen(options: { year?: boolean } = {}) {
  const timeZone = useContext(TimeZone);
  return (at: At) =>
    at
      ? new Date(at).toLocaleString("en-GB", {
          timeZone,
          day: "numeric",
          month: "short",
          ...(options.year && { year: "numeric" }),
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
}

/** "16 Oct 2026"; "" with no date. */
export function useDay() {
  const timeZone = useContext(TimeZone);
  return (at: At) =>
    at
      ? new Date(at).toLocaleDateString("en-GB", {
          timeZone,
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";
}
