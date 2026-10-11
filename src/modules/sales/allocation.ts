/*
 * How money on a buyer's account is spread over their unpaid invoices. Pure,
 * so the payment window can show the same split the server records. Worked in
 * whole paisa (cents) so the parts always add up to the amount.
 */

export type OpenDue = { orderId: string; due: string | number };
export type AllocationLine = { orderId: string; amount: number };

const cents = (value: string | number) => Math.round(Number(value) * 100);

/**
 * Oldest due first: each invoice (listed oldest first) takes what it still
 * owes until the money runs out. What is left over is not in the result; it
 * stays on the buyer's account as advance balance.
 */
export function oldestFirst(dues: OpenDue[], amount: number): AllocationLine[] {
  let left = Math.max(cents(amount), 0);
  const lines: AllocationLine[] = [];
  for (const due of dues) {
    if (left <= 0) break;
    const take = Math.min(Math.max(cents(due.due), 0), left);
    if (take <= 0) continue;
    lines.push({ orderId: due.orderId, amount: take / 100 });
    left -= take;
  }
  return lines;
}

/** The total of some allocation lines, in money (two decimals). */
export function allocatedTotal(lines: Array<{ amount: number }>): number {
  return lines.reduce((sum, line) => sum + cents(line.amount), 0) / 100;
}

/** What is left of `amount` after the lines: kept as advance balance (never below zero). */
export function advanceLeft(amount: number, lines: Array<{ amount: number }>): number {
  return Math.max(cents(amount) - cents(allocatedTotal(lines)), 0) / 100;
}
