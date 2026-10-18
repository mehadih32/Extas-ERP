import { readFileSync } from "node:fs";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isRetryableTransactionError, runTransaction } from "@/lib/transaction";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("Query failed", { code, clientVersion: "test", meta });
/** What Prisma throws when Postgres cancels a row or advisory lock wait to break a deadlock. */
const deadlock = () => known("P2010", { code: "40P01", message: "ERROR: deadlock detected" });

describe("transactions cancelled by Postgres", () => {
  it("are recognised whichever way Prisma reports them", () => {
    expect(isRetryableTransactionError(deadlock())).toBe(true);
    expect(isRetryableTransactionError(known("P2034"))).toBe(true);
    expect(
      isRetryableTransactionError(
        new Prisma.PrismaClientUnknownRequestError(
          'QueryError(PostgresError { code: "40P01", message: "deadlock detected" })',
          { clientVersion: "test" },
        ),
      ),
    ).toBe(true);
  });

  it("are told apart from every other failure", () => {
    expect(isRetryableTransactionError(known("P2002"))).toBe(false);
    expect(isRetryableTransactionError(known("P2010", { code: "42883" }))).toBe(false);
    expect(isRetryableTransactionError(new Error("deadlock detected"))).toBe(false);
  });
});

describe("runTransaction", () => {
  beforeEach(() => {
    transaction.mockReset();
  });

  it("runs a transaction again after Postgres cancels it to break a deadlock", async () => {
    transaction.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce("saved");
    await expect(runTransaction(async () => "saved")).resolves.toBe("saved");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt and never repeats other failures", async () => {
    transaction.mockRejectedValue(deadlock());
    await expect(runTransaction(async () => null, undefined, 3)).rejects.toMatchObject({
      code: "P2010",
    });
    expect(transaction).toHaveBeenCalledTimes(3);

    transaction.mockReset();
    transaction.mockRejectedValue(known("P2002"));
    await expect(runTransaction(async () => null)).rejects.toMatchObject({ code: "P2002" });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

// v6.4.1 review 3: these money writes run again when Postgres cancels them to break a deadlock.
describe("money writes that retry after a deadlock", () => {
  const source = (file: string) => readFileSync(path.join(process.cwd(), "src", file), "utf8");
  /** The text of one exported function, up to the next top-level declaration. */
  const body = (file: string, name: string) => {
    const text = source(file);
    const start = text.indexOf(`export async function ${name}(`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const end = text.slice(start + 1).search(/\n(export |async function |function |const )/);
    return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
  };

  it("capital, investors, loans and owner withdrawals use runTransaction", () => {
    for (const file of [
      "modules/accounts/capital.service.ts",
      "modules/accounts/money-in-out.service.ts",
    ]) {
      expect(source(file), file).not.toContain("prisma.$transaction(");
    }
    expect(body("modules/accounts/capital.service.ts", "voidCapitalSource")).toContain(
      "runTransaction(",
    );
    expect(body("modules/accounts/money-in-out.service.ts", "withdrawFund")).toContain(
      "runTransaction(",
    );
  });

  it("an account's balance brought forward uses runTransaction", () => {
    const save = body("modules/accounts/chart.service.ts", "setAccountOpeningBalance");
    expect(save).toContain("runTransaction(");
    expect(save).not.toContain("$transaction(");
  });
});
