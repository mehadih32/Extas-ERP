"use client";

import { useEffect, useState } from "react";

/** A notice that clears itself after ten seconds. */
export function useNotice(initial?: string) {
  const [notice, setNotice] = useState(initial);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}
