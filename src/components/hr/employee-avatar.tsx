"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { hrHref } from "./labels";

const SIZES = {
  sm: "size-9 text-xs",
  md: "size-12 text-sm",
  lg: "size-16 text-lg",
  xl: "size-24 text-2xl",
} as const;

/** "Sabbir Ahmed" -> "SA", "Rahim" -> "R". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * An employee's photo (their newest "Photo" paper), or their initials when
 * there is none or it cannot be shown. Pictures load only when they scroll
 * into view and the browser keeps them.
 */
export function EmployeeAvatar({
  employeeId,
  photoId,
  name,
  size = "md",
  className,
}: {
  employeeId: string;
  photoId: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = cn(
    "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-secondary font-medium text-primary select-none",
    SIZES[size],
    className,
  );
  const photo = photoId && failed !== photoId ? photoId : null;
  // The initials stay underneath, so the circle is never empty while the photo loads.
  return (
    <span className={box}>
      <span aria-hidden>{initials(name)}</span>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the photo route with its own checks
        <img
          src={hrHref.photo(employeeId, photo)}
          alt={`Photo of ${name}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(photo)}
        />
      )}
    </span>
  );
}
