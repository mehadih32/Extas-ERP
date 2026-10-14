import { Badge } from "@/components/ui/badge";
import { DECISION_LABELS } from "@/modules/costing/costing-labels";

/** Taken, Declined, or Not decided. */
export function DecisionBadge({ decision }: { decision: "TAKE" | "DECLINE" | null }) {
  if (decision === null) return <Badge variant="outline">Not decided</Badge>;
  return (
    <Badge variant={decision === "TAKE" ? "default" : "alert"}>{DECISION_LABELS[decision]}</Badge>
  );
}
