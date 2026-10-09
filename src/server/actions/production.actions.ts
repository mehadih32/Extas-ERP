"use server";

import { revalidatePath } from "next/cache";

import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import * as screens from "@/modules/production/screens.service";

/*
 * Production Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   production.view           overview, projects, deliveries (costs need the next two)
 *   production.manage         projects, stages, cost heads, Due bills, voiding bills,
 *                             undoing a confirmed delivery
 *   accounts.payments.record  money paid out: Cash/Bank costs, paying bills (Accounts)
 *   accounts.manage           writing unrecovered cost off when completing / cancelling
 *   production.stock_intake   Move to Stock: deliveries, AI packing-list reading
 * Cost figures are shown to production.manage and accounts.view holders only.
 * Changes refresh the screens and hand back the record's id and code or number
 * only: the full records carry Decimal amounts, which do not cross to the
 * browser, so the screens reload the record from its page.
 */

const view = () => requirePermission("production.view");
const manage = () => requirePermission("production.manage");
const recordCosts = () => requireAnyPermission("production.manage", "accounts.payments.record");
const intakeView = () => requireAnyPermission("production.view", "production.stock_intake");
const intake = () => requirePermission("production.stock_intake");
/** Closing a project: Production, or Accounts when leftover cost has to be written off. */
const closeProject = () => requireAnyPermission("production.manage", "accounts.manage");
/** The pickers on the project, bill and delivery forms. */
const pickParties = () => requireAnyPermission("production.manage", "accounts.payments.record");
const pickStyles = () => requireAnyPermission("production.manage", "production.stock_intake");
const pickProjects = () =>
  requireAnyPermission("production.manage", "accounts.payments.record", "production.stock_intake");

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const result = await work();
    revalidatePath("/", "layout");
    return result;
  });

const project = (p: { id: string; code: string }) => ({ id: p.id, code: p.code });
const ref = (record: { id: string; number: string }) => ({
  id: record.id,
  number: record.number,
});

// --- Screens -------------------------------------------------------------------------
export const getOverviewScreenAction = async () =>
  runAction(async () => screens.getOverviewScreen(await view()));
export const getProjectListAction = async (query: unknown) =>
  runAction(async () => screens.getProjectList(await view(), query));
export const listProjectRowsAction = async (query: unknown) =>
  runAction(async () => screens.listProjectRows(await view(), query));
export const getProjectScreenAction = async (projectId: string) =>
  runAction(async () => screens.getProjectScreen(await view(), projectId));
export const getProjectFormAction = async (projectId?: string) =>
  runAction(async () => screens.getProjectForm(await manage(), projectId));
export const findProductionPartiesAction = async (query: {
  kind: "SUPPLIER" | "BUYER";
  search?: string;
}) => runAction(async () => screens.findProductionParties(await pickParties(), query));
export const findProjectsAction = async (query: { search?: string; purpose: "COST" | "RECEIVE" }) =>
  runAction(async () => screens.findProjects(await pickProjects(), query));
export const findProductionStylesAction = async (query: { search?: string }) =>
  runAction(async () => screens.findProductionStyles(await pickStyles(), query));
export const getIntakeMatrixAction = async (styleId: string) =>
  runAction(async () => screens.getIntakeMatrix(await pickStyles(), styleId));
export const getIntakeListAction = async (query: unknown) =>
  runAction(async () => screens.getIntakeList(await intakeView(), query));
export const listIntakeRowsAction = async (query: unknown) =>
  runAction(async () => screens.listIntakeRows(await intakeView(), query));
export const getIntakeScreenAction = async (intakeId: string) =>
  runAction(async () => screens.getIntakeScreen(await intakeView(), intakeId));
export const getIntakeFormAction = async (options: { projectId?: string; intakeId?: string }) =>
  runAction(async () => screens.getIntakeForm(await intake(), options));
export const getBillListAction = async (query: unknown) =>
  runAction(async () => screens.getBillList(await view(), query));
export const listBillRowsAction = async (query: unknown) =>
  runAction(async () => screens.listBillRows(await view(), query));
export const getBillScreenAction = async (billId: string) =>
  runAction(async () => screens.getBillScreen(await view(), billId));
export const getBillFormAction = async (options: { projectId?: string } = {}) =>
  runAction(async () => screens.getBillForm(await recordCosts(), options));
export const getCostHeadsScreenAction = async () =>
  runAction(async () => screens.getCostHeadsScreen(await view()));

// --- Overview & projects -------------------------------------------------------------
export const getProductionOverviewAction = async () =>
  runAction(async () => projects.getProductionOverview(await view()));
export const listProjectsAction = async (query: unknown) =>
  runAction(async () => projects.listProjects(await view(), query));
export const getProjectAction = async (projectId: string) =>
  runAction(async () => projects.getProject(await view(), projectId));
export const createProjectAction = async (input: unknown) =>
  change(async () =>
    project(await projects.createProject(await manage(), input, await getRequestMeta())),
  );
export const updateProjectAction = async (projectId: string, input: unknown) =>
  change(async () =>
    project(await projects.updateProject(await manage(), projectId, input, await getRequestMeta())),
  );
export const setProjectStageAction = async (projectId: string, input: unknown) =>
  change(async () =>
    project(
      await projects.setProjectStage(await manage(), projectId, input, await getRequestMeta()),
    ),
  );
export const setProjectStatusAction = async (projectId: string, input: unknown) =>
  change(async () =>
    project(
      await projects.setProjectStatus(await manage(), projectId, input, await getRequestMeta()),
    ),
  );
export const completeProjectAction = async (projectId: string, input: unknown) =>
  change(async () =>
    project(
      await projects.completeProject(
        await closeProject(),
        projectId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const cancelProjectAction = async (projectId: string, input: unknown) =>
  change(async () =>
    project(
      await projects.cancelProject(await closeProject(), projectId, input, await getRequestMeta()),
    ),
  );

// --- Costs ---------------------------------------------------------------------------
export const listCostHeadsAction = async (query: unknown) =>
  runAction(async () => costs.listCostHeads(await view(), query));
export const createCostHeadAction = async (input: unknown) =>
  change(async () => costs.createCostHead(await manage(), input, await getRequestMeta()));
export const updateCostHeadAction = async (headId: string, input: unknown) =>
  change(async () => costs.updateCostHead(await manage(), headId, input, await getRequestMeta()));
export const getProjectCostSheetAction = async (projectId: string) =>
  runAction(async () => costs.getProjectCostSheet(await view(), projectId));
export const addProjectCostAction = async (projectId: string, input: unknown) =>
  change(async () =>
    project(
      (await costs.addProjectCost(await recordCosts(), projectId, input, await getRequestMeta()))
        .project,
    ),
  );
export const voidProjectCostAction = async (expenseId: string, input: unknown) =>
  change(async () =>
    project(
      (
        await costs.voidProjectCost(
          await requirePermission("accounts.payments.record"),
          expenseId,
          input,
          await getRequestMeta(),
        )
      ).project,
    ),
  );

// --- Supplier bills (Split Bill) ---------------------------------------------------------
export const listBillsAction = async (query: unknown) =>
  runAction(async () => costs.listBills(await view(), query));
export const getBillAction = async (billId: string) =>
  runAction(async () => costs.getBill(await view(), billId));
export const createBillAction = async (input: unknown) =>
  change(async () =>
    ref(await costs.createBill(await recordCosts(), input, await getRequestMeta())),
  );
export const payBillAction = async (billId: string, input: unknown) =>
  change(async () =>
    ref(
      await costs.payBill(
        await requirePermission("accounts.payments.record"),
        billId,
        input,
        await getRequestMeta(),
      ),
    ),
  );
export const voidBillAction = async (billId: string, input: unknown) =>
  change(async () =>
    ref(
      await costs.voidBill(
        await requireAnyPermission("production.manage", "accounts.manage"),
        billId,
        input,
        await getRequestMeta(),
      ),
    ),
  );

// --- Uploads & Move to Stock --------------------------------------------------------------
/** FormData with a `file` field: a packing-list photo / PDF or a bill scan (10 MB max). */
export const uploadProductionFileAction = async (form: FormData) =>
  runAction(async () => {
    const asset = await files.storeUpload(
      await requireAnyPermission(
        "production.manage",
        "production.stock_intake",
        "accounts.payments.record",
      ),
      await files.fileFromForm(form),
      await getRequestMeta(),
    );
    return { id: asset.id, fileName: asset.fileName };
  });
export const listIntakesAction = async (query: unknown) =>
  runAction(async () => intakes.listIntakes(await intakeView(), query));
export const getIntakeAction = async (intakeId: string) =>
  runAction(async () => intakes.getIntake(await intakeView(), intakeId));
export const createIntakeAction = async (input: unknown) =>
  change(async () => {
    const created = await intakes.createIntake(await intake(), input, await getRequestMeta());
    return { ...ref(created), aiError: created.aiError };
  });
export const updateIntakeAction = async (intakeId: string, input: unknown) =>
  change(async () =>
    ref(await intakes.updateIntake(await intake(), intakeId, input, await getRequestMeta())),
  );
export const parseIntakeAction = async (intakeId: string) =>
  change(async () =>
    ref(await intakes.parseIntake(await intake(), intakeId, await getRequestMeta())),
  );
export const confirmIntakeAction = async (intakeId: string, input: unknown) =>
  change(async () =>
    ref(await intakes.confirmIntake(await intake(), intakeId, input, await getRequestMeta())),
  );
export const cancelIntakeAction = async (intakeId: string) =>
  change(async () =>
    ref(await intakes.cancelIntake(await intake(), intakeId, await getRequestMeta())),
  );
/** Undo a confirmed delivery (Production Managers): { reason, redraft? }. */
export const reverseIntakeAction = async (intakeId: string, input: unknown) =>
  change(async () => {
    const undone = await intakes.reverseIntake(
      await manage(),
      intakeId,
      input,
      await getRequestMeta(),
    );
    return { ...ref(undone), redraft: undone.redraft };
  });
