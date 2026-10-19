import Link from "next/link";

import { FormAlert } from "@/components/forms/field";

import { productionHref } from "./labels";

/**
 * A saved CM settlement is worked out from what this screen shows (the style's
 * cutting, finishing or CM): it stays as it is until the settlement is undone,
 * which is done on the batch's CM settlement (the link).
 */
export function CmSettledNotice({
  settlement,
  from,
  what,
}: {
  settlement: { number: string; batchId: string; batchCode: string };
  /** What the settlement is worked out from: "this style's cutting". */
  from: string;
  /** What stays: "no cutting report can be added or deleted". */
  what: string;
}) {
  return (
    <FormAlert tone="note">
      <span className="font-medium">Undo the CM settlement first.</span> {settlement.number} for
      batch {settlement.batchCode} is worked out from {from}, so {what} until it is undone.{" "}
      <Link
        href={productionHref.cmSettlement(settlement.batchId)}
        className="font-medium underline underline-offset-4"
      >
        Open {settlement.number}
      </Link>
    </FormAlert>
  );
}
