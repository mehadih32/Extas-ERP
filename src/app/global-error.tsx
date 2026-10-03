"use client";

import "@/styles/globals.css";

import { ScreenError } from "@/components/feedback/screen-error";

import { fontVariables } from "./fonts";

/** Replaces the whole page when even the root layout fails, so it brings its own styles. */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <title>Something went wrong · Extras ERP</title>
        <ScreenError {...props} />
      </body>
    </html>
  );
}
