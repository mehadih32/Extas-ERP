import type { BackgroundJob } from "@prisma/client";

import type { JobKind } from "@/modules/jobs/queue";

/*
 * What each kind of background job does. A handler gets the job (its payload)
 * and either finishes or throws; the queue retries a throw (queue.ts). Each is
 * loaded only when a job of its kind runs.
 */

export type JobHandler = (job: BackgroundJob) => Promise<void>;

export const JOB_HANDLERS: Record<JobKind, () => Promise<JobHandler>> = {
  "terms.pdf": async () => (await import("@/modules/hr/terms-pdf")).runTermsPdfJob,
  "claim.route": async () => (await import("@/modules/hr/claims.service")).runClaimRouteJob,
  "salary.payout": async () => (await import("@/modules/hr/payroll.service")).runSalaryPayoutJob,
  "exit.certificate": async () => (await import("@/modules/hr/exit-pdf")).runExitCertificateJob,
};

export function isJobKind(kind: string): kind is JobKind {
  return Object.hasOwn(JOB_HANDLERS, kind);
}
