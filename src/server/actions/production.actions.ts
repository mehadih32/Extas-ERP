"use server";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";

/*
 * Production Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   production.view           overview, projects, deliveries (costs need the next two)
 *   production.manage         projects, stages, cost heads, Due bills, voiding bills
 *   accounts.payments.record  money paid out: Cash/Bank costs, paying bills (Accounts)
 *   accounts.manage           writing unrecovered cost off when completing / cancelling
 *   production.stock_intake   Move to Stock: deliveries, AI packing-list reading
 * Cost figures are shown to production.manage and accounts.view holders only.
 */

const view = () => requirePermission("production.view");
const manage = () => requirePermission("production.manage");
const recordCosts = () => requireAnyPermission("production.manage", "accounts.payments.record");
const intakeView = () => requireAnyPermission("production.view", "production.stock_intake");
const intake = () => requirePermission("production.stock_intake");
/** Closing a project: Production, or Accounts when leftover cost has to be written off. */
const closeProject = () => requireAnyPermission("production.manage", "accounts.manage");

// --- Overview & projects -------------------------------------------------------------
export const getProductionOverviewAction = async () =>
  runAction(async () => projects.getProductionOverview(await view()));
export const listProjectsAction = async (query: unknown) =>
  runAction(async () => projects.listProjects(await view(), query));
export const getProjectAction = async (projectId: string) =>
  runAction(async () => projects.getProject(await view(), projectId));
export const createProjectAction = async (input: unknown) =>
  runAction(async () => projects.createProject(await manage(), input, await getRequestMeta()));
export const updateProjectAction = async (projectId: string, input: unknown) =>
  runAction(async () =>
    projects.updateProject(await manage(), projectId, input, await getRequestMeta()),
  );
export const setProjectStageAction = async (projectId: string, input: unknown) =>
  runAction(async () =>
    projects.setProjectStage(await manage(), projectId, input, await getRequestMeta()),
  );
export const setProjectStatusAction = async (projectId: string, input: unknown) =>
  runAction(async () =>
    projects.setProjectStatus(await manage(), projectId, input, await getRequestMeta()),
  );
export const completeProjectAction = async (projectId: string, input: unknown) =>
  runAction(async () =>
    projects.completeProject(await closeProject(), projectId, input, await getRequestMeta()),
  );
export const cancelProjectAction = async (projectId: string, input: unknown) =>
  runAction(async () =>
    projects.cancelProject(await closeProject(), projectId, input, await getRequestMeta()),
  );

// --- Costs ---------------------------------------------------------------------------
export const listCostHeadsAction = async (query: unknown) =>
  runAction(async () => costs.listCostHeads(await view(), query));
export const createCostHeadAction = async (input: unknown) =>
  runAction(async () => costs.createCostHead(await manage(), input, await getRequestMeta()));
export const updateCostHeadAction = async (headId: string, input: unknown) =>
  runAction(async () =>
    costs.updateCostHead(await manage(), headId, input, await getRequestMeta()),
  );
export const getProjectCostSheetAction = async (projectId: string) =>
  runAction(async () => costs.getProjectCostSheet(await view(), projectId));
export const addProjectCostAction = async (projectId: string, input: unknown) =>
  runAction(async () =>
    costs.addProjectCost(await recordCosts(), projectId, input, await getRequestMeta()),
  );
export const voidProjectCostAction = async (expenseId: string, input: unknown) =>
  runAction(async () =>
    costs.voidProjectCost(
      await requirePermission("accounts.payments.record"),
      expenseId,
      input,
      await getRequestMeta(),
    ),
  );

// --- Supplier bills (Split Bill) ---------------------------------------------------------
export const listBillsAction = async (query: unknown) =>
  runAction(async () => costs.listBills(await view(), query));
export const getBillAction = async (billId: string) =>
  runAction(async () => costs.getBill(await view(), billId));
export const createBillAction = async (input: unknown) =>
  runAction(async () => costs.createBill(await recordCosts(), input, await getRequestMeta()));
export const payBillAction = async (billId: string, input: unknown) =>
  runAction(async () =>
    costs.payBill(
      await requirePermission("accounts.payments.record"),
      billId,
      input,
      await getRequestMeta(),
    ),
  );
export const voidBillAction = async (billId: string, input: unknown) =>
  runAction(async () =>
    costs.voidBill(
      await requireAnyPermission("production.manage", "accounts.manage"),
      billId,
      input,
      await getRequestMeta(),
    ),
  );

// --- Uploads & Move to Stock --------------------------------------------------------------
/** FormData with a `file` field: a packing-list photo / PDF or a bill scan (10 MB max). */
export const uploadProductionFileAction = async (form: FormData) =>
  runAction(async () =>
    files.storeUpload(
      await requireAnyPermission(
        "production.manage",
        "production.stock_intake",
        "accounts.payments.record",
      ),
      await files.fileFromForm(form),
      await getRequestMeta(),
    ),
  );
export const listIntakesAction = async (query: unknown) =>
  runAction(async () => intakes.listIntakes(await intakeView(), query));
export const getIntakeAction = async (intakeId: string) =>
  runAction(async () => intakes.getIntake(await intakeView(), intakeId));
export const createIntakeAction = async (input: unknown) =>
  runAction(async () => intakes.createIntake(await intake(), input, await getRequestMeta()));
export const updateIntakeAction = async (intakeId: string, input: unknown) =>
  runAction(async () =>
    intakes.updateIntake(await intake(), intakeId, input, await getRequestMeta()),
  );
export const parseIntakeAction = async (intakeId: string) =>
  runAction(async () => intakes.parseIntake(await intake(), intakeId, await getRequestMeta()));
export const confirmIntakeAction = async (intakeId: string, input: unknown) =>
  runAction(async () =>
    intakes.confirmIntake(await intake(), intakeId, input, await getRequestMeta()),
  );
export const cancelIntakeAction = async (intakeId: string) =>
  runAction(async () => intakes.cancelIntake(await intake(), intakeId, await getRequestMeta()));
