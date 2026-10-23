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
  "ai.knowledge.test": async () =>
    (await import("@/modules/ai/knowledge.service")).runKnowledgeTestJob,
  "ai.skill.test": async () => (await import("@/modules/ai/skills.service")).runSkillTestJob,
  "ai.bot.incoming": async () => (await import("@/modules/ai/bot/incoming")).runBotIncomingJob,
  "ai.bot.push": async () => (await import("@/modules/ai/bot/push")).runBotPushJob,
  "ecommerce.webhook.send": async () =>
    (await import("@/modules/ecommerce/webhooks")).runWebhookSendJob,
};

export function isJobKind(kind: string): kind is JobKind {
  return Object.hasOwn(JOB_HANDLERS, kind);
}
