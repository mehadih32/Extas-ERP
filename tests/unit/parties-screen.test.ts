import type { Party } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  amountCell,
  balanceText,
  balanceTone,
  drCr,
  kindLabel,
  listOf,
  money,
  partyHref,
} from "@/components/parties/labels";
import {
  isFiltered,
  PARTY_PAGE_SIZE,
  partyListQuery,
  partyListSearch,
  partyListViewFrom,
} from "@/components/parties/list-view";
import { dayParam, listName } from "@/components/parties/route";
import { visiblePartiesTabs } from "@/components/parties/tabs";
import {
  canChangeKind,
  canChangeStanding,
  canEditFields,
  canSetOpeningBalance,
  canSetStatus,
  statusChoices,
} from "@/modules/parties/rules";
import { listPartiesSchema } from "@/modules/parties/schemas";

type Account = Pick<Party, "kind" | "status" | "systemRole">;
const buyer: Account = { kind: "BUYER", status: "ACTIVE", systemRole: null };
const supplier: Account = { kind: "SUPPLIER", status: "ACTIVE", systemRole: null };
const walkIn: Account = { kind: "BUYER", status: "ACTIVE", systemRole: "WALK_IN" };

describe("buyer and supplier list filters", () => {
  it("reads the filters from the address and ignores anything malformed", () => {
    expect(
      partyListViewFrom("buyers", {
        q: "  rahman ",
        status: "DORMANT",
        grade: "A_PLUS",
        type: "WHOLESALE",
        verified: "1",
      }),
    ).toEqual({
      list: "buyers",
      q: "rahman",
      status: "DORMANT",
      grade: "A_PLUS",
      type: "WHOLESALE",
      verified: true,
    });
    expect(
      partyListViewFrom("suppliers", {
        q: ["a", "b"],
        status: "GONE",
        grade: "a_plus",
        type: "WHOLESALE",
        verified: "yes",
      }),
    ).toEqual({
      list: "suppliers",
      q: "",
      status: undefined,
      grade: undefined,
      type: undefined,
      verified: false,
    });
    expect(partyListViewFrom("buyers", { q: "x".repeat(150) }).q).toHaveLength(100);
  });

  it("keeps only the filters set in the address, and round-trips them", () => {
    const view = partyListViewFrom("buyers", {
      q: "rahman traders",
      grade: "B",
      type: "RETAIL",
      verified: "1",
    });
    const search = partyListSearch(view);
    expect(search).toBe("?q=rahman+traders&grade=B&type=RETAIL&verified=1");
    const back = Object.fromEntries(new URLSearchParams(search.slice(1)));
    expect(partyListViewFrom("buyers", back)).toEqual(view);
    expect(partyListSearch(partyListViewFrom("suppliers", {}))).toBe("");
    // Suppliers have no buyer type, so it never reaches their address.
    expect(partyListSearch({ ...view, list: "suppliers" })).toBe(
      "?q=rahman+traders&grade=B&verified=1",
    );
  });

  it("knows when the list is narrowed", () => {
    expect(isFiltered(partyListViewFrom("buyers", {}))).toBe(false);
    expect(isFiltered(partyListViewFrom("buyers", { q: "  " }))).toBe(false);
    expect(isFiltered(partyListViewFrom("buyers", { status: "CLOSED" }))).toBe(true);
    expect(isFiltered(partyListViewFrom("buyers", { verified: "1" }))).toBe(true);
  });

  it("asks the server for the right kind, in pages the list schema accepts", () => {
    const buyers = partyListQuery(
      partyListViewFrom("buyers", { q: "01711", type: "B2B_CORPORATE", verified: "1" }),
      "cursor-1",
    );
    expect(buyers).toEqual({
      kind: "BUYER",
      search: "01711",
      status: undefined,
      grade: undefined,
      buyerType: "B2B_CORPORATE",
      verified: true,
      cursor: "cursor-1",
      take: PARTY_PAGE_SIZE,
    });
    expect(listPartiesSchema.parse(buyers)).toMatchObject({ kind: "BUYER", take: 30 });
    const suppliers = partyListQuery(partyListViewFrom("suppliers", {}));
    expect(suppliers).toMatchObject({ kind: "SUPPLIER", search: undefined, verified: undefined });
    expect(listPartiesSchema.parse(suppliers)).toEqual({ kind: "SUPPLIER", take: 30 });
  });
});

describe("buyer and supplier words and figures", () => {
  it("puts buyers and accounts that are both under buyers", () => {
    expect([listOf("BUYER"), listOf("BOTH"), listOf("SUPPLIER")]).toEqual([
      "buyers",
      "buyers",
      "suppliers",
    ]);
    expect(partyHref({ id: "p1", kind: "SUPPLIER" })).toBe("/parties/suppliers/p1");
    expect(partyHref({ id: "p1", kind: "BOTH" }, "/statement")).toBe(
      "/parties/buyers/p1/statement",
    );
    expect(kindLabel({ kind: "BUYER", buyerType: "WHOLESALE" })).toBe("Wholesale buyer");
    expect(kindLabel({ kind: "BOTH", buyerType: "RETAIL" })).toBe("Buyer and supplier");
    expect(kindLabel({ kind: "SUPPLIER", buyerType: null })).toBe("Supplier");
  });

  it("says who owes whom, from the company's side", () => {
    expect(balanceText("125000.00", "BDT")).toBe("Owes you BDT 1,25,000.00");
    expect(balanceText("-3000.50", "BDT")).toBe("You owe BDT 3,000.50");
    expect(balanceText("0.00", "BDT")).toBe("Settled");
    expect(balanceText("-0.00", "USD")).toBe("Settled");
    expect([balanceTone("10.00"), balanceTone("-10.00"), balanceTone("0.00")]).toEqual([
      "owed",
      "owing",
      "settled",
    ]);
    expect(money("-125000.00", "USD")).toBe("USD 125,000.00");
  });

  it("marks statement balances Dr when owed to the company and Cr when owed by it", () => {
    expect(drCr("12500.00", "BDT")).toBe("12,500.00 Dr");
    expect(drCr("-3000.00", "BDT")).toBe("3,000.00 Cr");
    expect(drCr("0.00", "BDT")).toBe("0.00");
    expect(amountCell("0.00", "BDT")).toBe("");
    expect(amountCell("1500000.00", "BDT")).toBe("15,00,000.00");
  });
});

describe("buyer and supplier addresses", () => {
  it("knows only the two lists", () => {
    expect([listName("buyers"), listName("suppliers"), listName("dues")]).toEqual([
      "buyers",
      "suppliers",
      null,
    ]);
  });

  it("takes only real calendar days from the address", () => {
    expect(dayParam("2026-02-28")).toBe("2026-02-28");
    expect(dayParam("2028-02-29")).toBe("2028-02-29");
    expect(dayParam("2026-02-29")).toBeUndefined();
    expect(dayParam("2026-13-01")).toBeUndefined();
    expect(dayParam("2026-9-1")).toBeUndefined();
    expect(dayParam(["2026-09-01"])).toBeUndefined();
    expect(dayParam(undefined)).toBeUndefined();
  });

  it("shows the Dues tab only with the ledger permission", () => {
    const tabs = (held: string[]) => visiblePartiesTabs(held).map((t) => t.label);
    expect(tabs(["parties.view"])).toEqual(["Buyers", "Suppliers"]);
    expect(tabs(["parties.view", "parties.ledger.view"])).toEqual(["Buyers", "Suppliers", "Dues"]);
    expect(tabs(["parties.ledger.view"])).toEqual(["Dues"]);
    expect(tabs([])).toEqual([]);
  });
});

describe("what may be done with a buyer or supplier", () => {
  it("offers the statuses each account can move to", () => {
    expect(statusChoices(buyer)).toEqual(["DORMANT", "CLOSED"]);
    expect(statusChoices(supplier)).toEqual(["CLOSED"]);
    expect(statusChoices({ ...buyer, status: "DORMANT" })).toEqual(["ACTIVE", "CLOSED"]);
    expect(statusChoices({ ...buyer, status: "SETTLING" })).toEqual(["ACTIVE", "CLOSED"]);
    expect(statusChoices({ ...buyer, status: "CLOSED" })).toEqual(["ACTIVE"]);
    expect(statusChoices({ ...buyer, kind: "BOTH" })).toEqual(["DORMANT", "CLOSED"]);
    expect(statusChoices(walkIn)).toEqual([]);
    // Every status offered is one the action accepts.
    for (const account of [buyer, supplier, walkIn]) {
      for (const status of statusChoices(account)) {
        expect(canSetStatus(account, status).ok).toBe(true);
      }
    }
    expect(canSetStatus(supplier, "DORMANT")).toEqual({
      ok: false,
      code: "VALIDATION",
      message: "Only buyers can be marked dormant.",
    });
  });

  it("keeps Walk-in customers to its name and notes, with no grade or badge", () => {
    expect(canEditFields(walkIn, ["name", "notes"]).ok).toBe(true);
    expect(canEditFields(walkIn, ["name", "phone"]).ok).toBe(false);
    expect(canEditFields(buyer, ["phone", "kind"]).ok).toBe(true);
    expect(canChangeStanding(walkIn).ok).toBe(false);
    expect(canChangeStanding(buyer).ok).toBe(true);
  });

  it("changes between buyer and supplier only with nothing owed", () => {
    expect(canChangeKind("BUYER", "SUPPLIER", true).ok).toBe(true);
    expect(canChangeKind("BUYER", "SUPPLIER", false).ok).toBe(false);
    expect(canChangeKind("BOTH", "BUYER", false).ok).toBe(false);
    expect(canChangeKind("SUPPLIER", "BOTH", false).ok).toBe(true);
    expect(canChangeKind("BUYER", "BUYER", false).ok).toBe(true);
  });

  it("takes a supplier's opening balance only as what was owed to them", () => {
    expect(canSetOpeningBalance({ kind: "SUPPLIER" }, 500).ok).toBe(false);
    expect(canSetOpeningBalance({ kind: "SUPPLIER" }, -500).ok).toBe(true);
    expect(canSetOpeningBalance({ kind: "BUYER" }, 500).ok).toBe(true);
    expect(canSetOpeningBalance({ kind: "BOTH" }, 500).ok).toBe(true);
  });
});
