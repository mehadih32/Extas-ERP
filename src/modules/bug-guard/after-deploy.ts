import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import { takeRequest } from "./after-restore";
import { reportNotChecked } from "./report";
import { startBugGuard } from "./runner";
import { platformCompanyId } from "./security";
import type { Check } from "./types";

/*
 * Bug Guard once after each update of the live site (v6.4.1, D5). deploy.sh
 * leaves BACKUP_DIR/bug-guard-after-deploy.json once the new version is up and
 * its screens opened (deploy/lib.sh, ask_check_after_deploy); the ERP's clock
 * (clock.ts) takes it once and runs Bug Guard on every company:
 *   - every check only reads (runner.ts, readOnly), and none calls the AI;
 *   - nothing is prepared or corrected, even when the owner lets Bug Guard
 *     prepare fixes by itself on its schedule;
 *   - on the platform's own company it asks GitHub for a new Full check (every
 *     screen as each role with its own check account, only reading on the live
 *     site), whose result is reported when it comes back.
 * The report goes to the ERP inbox and on Telegram (the owner's own alarm, sent
 * whether the AI is on or off), marked "after the update". A company that could
 * not be checked is told too: the update itself stays installed.
 * A restore drill copy or a copy on standby takes the request too (deploy.sh does
 * not wait for it) but checks nothing: the Full check is of the live address, which
 * such a copy does not own; its own Bug Guard schedule goes on as before.
 */

export const AFTER_DEPLOY_REQUEST = "bug-guard-after-deploy.json";

export type AfterDeployCompany = {
  companyId: string;
  status: "DONE" | "FAILED" | "NOT_RUN";
  note?: string;
};

/** When this server process started: a run "checking" from before then was cut short. */
const processStartedAt = () => new Date(Date.now() - process.uptime() * 1000);

/**
 * Runs the check after an update when the server asked for it. Null when
 * nothing was asked (or on the demo site). `checks` only for the tests.
 */
export async function bugGuardAfterDeploy(
  options: { checks?: readonly Check[] } = {},
): Promise<AfterDeployCompany[] | null> {
  if (process.env.DEMO_SITE === "on") return null;
  const asked = await takeRequest(AFTER_DEPLOY_REQUEST);
  if (!asked) return null;
  const { notTheErpInUse } = await import("@/modules/backups/standby");
  const notOurs = await notTheErpInUse();
  if (notOurs) {
    console.log(`[bug-guard] after the update: not checked here, ${notOurs}`);
    return null;
  }
  const platform = await platformCompanyId();
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const results: AfterDeployCompany[] = [];
  for (const company of companies) {
    try {
      const started = await startBugGuard(company.id, "AFTER_DEPLOY", null, {
        wait: true,
        // GitHub's Full check is the platform owner's (AI Center > Full check).
        fullCheck: company.id === platform,
        freshFullCheck: true,
        prepare: false,
        staleBefore: processStartedAt(),
        checks: options.checks,
      });
      const run = await prisma.bugGuardRun.findUniqueOrThrow({ where: { id: started.id } });
      if (run.status === "DONE") {
        results.push({ companyId: company.id, status: "DONE" });
        continue;
      }
      const note = run.note ?? "The check stopped.";
      results.push({ companyId: company.id, status: "FAILED", note });
      await reportNotChecked(company.id, note, run.id);
    } catch (error) {
      const note = error instanceof AppError ? error.message : "Bug Guard could not start.";
      results.push({ companyId: company.id, status: "NOT_RUN", note });
      await reportNotChecked(company.id, note, company.id).catch((e: unknown) =>
        console.error("[bug-guard] after the update: not told", e),
      );
    }
  }
  return results;
}
