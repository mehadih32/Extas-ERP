import Link from "next/link";

import { FormAlert } from "@/components/forms/field";

import { productionHref } from "./labels";

/**
 * A saved CM settlement stands on what this screen shows (the style's cutting,
 * finishing or CM): it stays as it is until the settlement is undone, which is
 * done on the batch's CM settlement (the link).
 */
export function CmSettledNotice({
  settlement,
  what,
}: {
  settlement: { number: string; batchId: string; batchCode: string };
  /** What stays: "These reports stay", "Its CM stays". */
  what: string;
}) {
  return (
    <FormAlert tone="note">
      <span className="font-medium">Undo the CM settlement first.</span> {what} while{" "}
      {settlement.number} for {settlement.batchCode} is saved on them.{" "}
      <Link
        href={productionHref.cmSettlement(settlement.batchId)}
        className="font-medium underline underline-offset-4"
      >
        Open {settlement.number}
      </Link>
    </FormAlert>
  );
}
