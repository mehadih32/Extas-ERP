"use client";

import { ScreenError } from "@/components/feedback/screen-error";

export default function Error(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ScreenError {...props} />;
}
