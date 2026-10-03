"use client";

import { ScreenError } from "@/components/feedback/screen-error";

/** A failed screen inside the app keeps the top bar, with the error modal over it. */
export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ScreenError {...props} />;
}
