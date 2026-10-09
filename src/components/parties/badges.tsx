import type { PartyGrade, PartyStatus } from "@prisma/client";
import { BadgeCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { GRADE_LABELS, STATUS_LABELS } from "./labels";

/** The 💙 Blue Verified badge: a blue tick with its name for screen readers (and in full). */
export function VerifiedBadge({ full = false, className }: { full?: boolean; className?: string }) {
  if (!full) {
    return (
      <BadgeCheckIcon
        role="img"
        aria-label="Blue Verified"
        className={cn("size-4 shrink-0 text-verified", className)}
      />
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn("border-verified/30 bg-verified/5 text-verified", className)}
    >
      <BadgeCheckIcon aria-hidden />
      Blue Verified
    </Badge>
  );
}

const GRADE_STYLES: Record<PartyGrade, string> = {
  A_PLUS: "border-transparent bg-primary text-primary-foreground",
  A: "border-primary/30 bg-secondary text-primary",
  B: "border-border bg-muted text-foreground",
  C: "border-destructive/25 bg-destructive/5 text-destructive",
};

/** "Grade A+": strongest in the brand green, C in the alert red. */
export function GradeBadge({ grade, className }: { grade: PartyGrade; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("tracking-normal normal-case", GRADE_STYLES[grade], className)}
    >
      <span className="sr-only">Grade </span>
      {GRADE_LABELS[grade]}
    </Badge>
  );
}

/** The account's status; nothing for an active one unless `showActive`. */
export function StatusBadge({
  status,
  showActive = false,
  className,
}: {
  status: PartyStatus;
  showActive?: boolean;
  className?: string;
}) {
  if (status === "ACTIVE" && !showActive) return null;
  return (
    <Badge
      variant={status === "SETTLING" ? "alert" : status === "ACTIVE" ? "secondary" : "outline"}
      className={cn(
        status === "CLOSED" || status === "DORMANT" ? "text-muted-foreground" : "",
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}
