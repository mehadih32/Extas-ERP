import { AppError } from "@/lib/errors";

import { bdMobile } from "./sms";
import { type PlugStatus, providerOf, serverSettings, type Settings } from "./config";

/*
 * Paying money out to a staff member's bKash, Nagad or Rocket wallet (salary,
 * reimbursements). Off until PAYOUT_PROVIDER is set; until then Accounts pays
 * by hand and records it, as today. "log" is test mode: nothing is sent and no
 * money moves, each payout is written to the server log. A real wallet
 * (bKash disbursement, Nagad) is added here as another provider; callers only
 * see this shape. Recording a payment in the books stays with Accounts.
 */

const SETTINGS = ["PAYOUT_PROVIDER"] as const;

export const PAYOUT_WALLETS = ["BKASH", "NAGAD", "ROCKET"] as const;
export type PayoutWallet = (typeof PAYOUT_WALLETS)[number];

export type PayoutRequest = {
  wallet: PayoutWallet;
  /** The receiver's wallet number. */
  to: string;
  /** "1500.00", in BDT. */
  amount: string;
  /** Our reference, shown in the receiver's statement: "SAL-2026-10 EMP-0007". */
  reference: string;
};

export type PayoutResult =
  { ok: true; providerReference: string; test: boolean } | { ok: false; error: string };

export type PayoutGateway = {
  provider: "log";
  /** Whether no money really moves (test mode). */
  test: boolean;
  supports: (wallet: PayoutWallet) => boolean;
  send: (request: PayoutRequest) => Promise<PayoutResult>;
};

export function payoutStatus(settings: Settings = serverSettings()): PlugStatus {
  const { provider, problem } = providerOf(settings, "PAYOUT_PROVIDER", ["log"] as const);
  return {
    key: "payouts",
    state: provider === "log" ? "TEST" : "OFF",
    provider,
    settings: SETTINGS,
    problem,
  };
}

/** The gateway the settings describe, or null while payouts are off. */
export function payoutGateway(settings: Settings = serverSettings()): PayoutGateway | null {
  if (payoutStatus(settings).state === "OFF") return null;
  let count = 0;
  return {
    provider: "log",
    test: true,
    supports: () => true,
    async send(request) {
      count += 1;
      console.info(
        `[payout:test] ${request.wallet} ${request.to} BDT ${request.amount} (${request.reference})`,
      );
      return { ok: true, providerReference: `TEST-${Date.now()}-${count}`, test: true };
    },
  };
}

/** Checks a payout before it goes: a wallet number, an amount above zero. */
export function checkPayout(request: PayoutRequest): PayoutRequest {
  const to = bdMobile(request.to);
  if (!to)
    throw new AppError("VALIDATION", "The wallet number is not a Bangladeshi mobile number.");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(request.amount) || Number(request.amount) <= 0) {
    throw new AppError("VALIDATION", "The amount must be more than zero.");
  }
  return { ...request, to };
}

/** Sends a payout through the connected wallet; refused while payouts are off. */
export async function sendPayout(
  request: PayoutRequest,
  gateway: PayoutGateway | null = payoutGateway(),
): Promise<PayoutResult> {
  if (!gateway) throw new AppError("UNAVAILABLE", "Wallet payouts are not connected yet.");
  const checked = checkPayout(request);
  if (!gateway.supports(checked.wallet)) {
    throw new AppError("UNAVAILABLE", `Payouts to ${checked.wallet} are not connected yet.`);
  }
  return gateway.send(checked);
}
