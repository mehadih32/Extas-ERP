import { describe, expect, it } from "vitest";

import { attempts, fileSize, PROOF_TARGET_BYTES, shrinkWith } from "@/lib/compress-image";
import { advanceLeft, allocatedTotal, oldestFirst } from "@/modules/sales/allocation";
import { createOrderSchema, receivePaymentSchema } from "@/modules/sales/schemas";

describe("money on a buyer's account, oldest due first", () => {
  const dues = [
    { orderId: "a", due: "1800.00" },
    { orderId: "b", due: "900.50" },
    { orderId: "c", due: 300 },
  ];

  it("pays each invoice in turn until the money runs out", () => {
    expect(oldestFirst(dues, 2000)).toEqual([
      { orderId: "a", amount: 1800 },
      { orderId: "b", amount: 200 },
    ]);
    expect(oldestFirst(dues, 0)).toEqual([]);
    expect(oldestFirst([{ orderId: "x", due: 0 }, ...dues], 100)).toEqual([
      { orderId: "a", amount: 100 },
    ]);
  });

  it("keeps what is left as advance balance, to the paisa", () => {
    const lines = oldestFirst(dues, 3500.6);
    expect(allocatedTotal(lines)).toBe(3000.5);
    expect(advanceLeft(3500.6, lines)).toBe(500.1);
    // 0.1 + 0.2 is not 0.3 in floating point; in paisa it is.
    expect(allocatedTotal([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
    expect(advanceLeft(100, [{ amount: 150 }])).toBe(0);
  });
});

describe("what payments and checkout accept", () => {
  const id = "c".padEnd(25, "x");

  it("spreads only money on account over invoices, and extra only on an order", () => {
    expect(
      receivePaymentSchema.safeParse({ orderId: id, amount: 5, method: "CASH", oldestFirst: true })
        .success,
    ).toBe(false);
    expect(
      receivePaymentSchema.safeParse({ partyId: id, amount: 5, method: "CASH", extra: "ADVANCE" })
        .success,
    ).toBe(false);
    expect(
      receivePaymentSchema.safeParse({
        partyId: id,
        amount: 5,
        method: "CASH",
        allocations: [{ orderId: id, amount: 5 }],
      }).success,
    ).toBe(true);
  });

  it("takes cheque details only with the Cheque method, and dues only with a buyer", () => {
    const order = { channel: "POS", lines: [{ variantId: id, quantity: 1 }] };
    const cash = createOrderSchema.safeParse({
      ...order,
      payment: { amount: 5, method: "CASH", cheque: { chequeNo: "1" } },
    });
    expect(cash.success).toBe(false);
    const noBuyer = createOrderSchema.safeParse({ ...order, includePreviousDue: true });
    expect(noBuyer.error?.issues[0]?.path).toEqual(["includePreviousDue"]);
  });
});

describe("making a proof photo small before it is sent", () => {
  it("tries the photo at most 1600 px, then smaller, never under 480 px", () => {
    const tries = attempts(4000, 3000);
    expect(tries[0]).toEqual({ width: 1600, height: 1200, quality: 0.82 });
    expect(tries.at(-1)!.width).toBe(480);
    expect(tries.every((t) => t.width >= 480)).toBe(true);
    // A small screenshot keeps its size.
    expect(attempts(400, 800)[0]).toEqual({ width: 400, height: 800, quality: 0.82 });
  });

  it("stops at the first try that fits, else keeps the smallest made", async () => {
    const tried: number[] = [];
    const fits = await shrinkWith(
      async ({ width, quality }) => {
        tried.push(quality);
        return new Blob([new Uint8Array(Math.round(width * quality * 100))]);
      },
      1600,
      1200,
    );
    expect(fits.size).toBeLessThanOrEqual(PROOF_TARGET_BYTES);
    expect(tried.length).toBeLessThan(attempts(1600, 1200).length);

    const huge = await shrinkWith(async () => new Blob([new Uint8Array(200 * 1024)]), 1600, 1200);
    expect(huge.size).toBe(200 * 1024);
  });

  it("writes sizes as people read them", () => {
    expect(fileSize(98_000)).toBe("96 KB");
    expect(fileSize(3_355_443)).toBe("3.2 MB");
    expect(fileSize(10)).toBe("1 KB");
  });
});
