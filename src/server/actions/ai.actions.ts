"use server";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request-meta";
import { runAction } from "@/lib/result";
import * as agentsScreen from "@/modules/ai/agents.service";
import * as control from "@/modules/ai/control.service";
import * as costs from "@/modules/ai/costs.service";
import * as helpAi from "@/modules/ai/help-ai.service";
import * as logs from "@/modules/ai/logs.service";
import * as modelTests from "@/modules/ai/model-tests.service";
import * as prices from "@/modules/ai/prices.service";
import * as requests from "@/modules/ai/requests.service";
import * as settings from "@/modules/ai/settings.service";
import * as skills from "@/modules/ai/skills.service";
import { requireAnyPermission, requireCompany, requirePermission } from "@/modules/auth/context";
import { MAX_UPLOAD_BYTES } from "@/modules/files/file.service";

/*
 * AI Center Server Actions. Each returns { ok: true, data } or { ok: false, error }.
 *   ai.view     see the AI Center: the switch, Control, Budget & Costs, Models,
 *               Logs and the AI's requests (ai.manage sees them too)
 *   ai.manage   turn AI on or off, pause it, set Control (cells, presets,
 *               grants), the budget, the models and their prices and tests, the
 *               Claude, OpenAI and Gemini keys and the PIN, and answer
 *               the AI's permission and Deletion requests (the owner's), switch
 *               agents on or off, and teach, change, undo and test skills
 *   (signed in) ask the Help AI on the Help Center (only while AI is on)
 * The AI itself holds neither: it can never change what it may do.
 */

const view = () => requireAnyPermission("ai.view", "ai.manage");
const manage = () => requirePermission("ai.manage");

const LOG_FILTER_VALUES: readonly string[] = logs.LOG_FILTERS.map((f) => f.value);

/** Runs a change and refreshes every screen that may show it. */
const change = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    await work();
    revalidatePath("/", "layout");
    return null;
  });

/** The same, handing back what the change found (a key test, a model test). */
const changeWith = <T>(work: () => Promise<T>) =>
  runAction(async () => {
    const out = await work();
    revalidatePath("/", "layout");
    return out;
  });

export const getAiStatusAction = async () =>
  runAction(async () => settings.getAiStatus(await view()));

export const getControlAction = async () => runAction(async () => control.getControl(await view()));

export const getModelsAction = async () => runAction(async () => settings.getModels(await view()));

export const getRequestsAction = async (history = false) =>
  runAction(async () => requests.getRequests(await view(), history));

export const getAiLogsAction = async (filter?: string) =>
  runAction(async () =>
    logs.getAiLogs(
      await view(),
      filter && LOG_FILTER_VALUES.includes(filter) ? (filter as logs.LogFilter) : "all",
    ),
  );

export const getCostsAction = async (query?: unknown) =>
  runAction(async () => costs.getCosts(await view(), query ?? {}));

export const getHelpAiAction = async () =>
  runAction(async () => helpAi.getHelpAi(await requireCompany()));

/** A question to the Help AI: it answers from the manual and changes nothing. */
export const askHelpAction = async (input: { question: string }) =>
  runAction(async () => helpAi.askHelp(await requireCompany(), input));

export const getAiMonthCostAction = async () =>
  runAction(async () => costs.getMonthCost(await view()));

const BOX_RECORDS: readonly string[] = costs.AI_BOX_RECORDS;

/** The AI box on a project, batch or order page (anyone signed in; the cost only for AI Center people). */
export const getAiRecordCostAction = async (type: string, id: string) =>
  runAction(async () => {
    if (!BOX_RECORDS.includes(type)) throw new AppError("VALIDATION", "No AI box for this record.");
    return costs.recordCost(await requireCompany(), { type, id: String(id).slice(0, 60) });
  });

export const setBudgetAction = async (input: unknown) =>
  change(async () => costs.setBudget(await manage(), input, await getRequestMeta()));

export const setAiSwitchAction = async (on: boolean) =>
  change(async () => settings.setAiSwitch(await manage(), on, await getRequestMeta()));

export const setAiPausedAction = async (paused: boolean) =>
  change(async () => settings.setAiPaused(await manage(), paused, await getRequestMeta()));

export const setControlCellAction = async (input: unknown) =>
  change(async () => control.setControlCell(await manage(), input, await getRequestMeta()));

export const applyPresetAction = async (preset: string) =>
  change(async () => control.applyPreset(await manage(), preset, await getRequestMeta()));

export const giveGrantAction = async (input: unknown) =>
  change(async () => control.giveGrant(await manage(), input, await getRequestMeta()));

export const endGrantAction = async (grantId: string) =>
  change(async () => control.endGrant(await manage(), grantId, await getRequestMeta()));

export const setTaskModelAction = async (input: unknown) =>
  change(async () => settings.setTaskModel(await manage(), input, await getRequestMeta()));

export const setFableAllowedAction = async (allowed: boolean) =>
  change(async () => settings.setFableAllowed(await manage(), allowed, await getRequestMeta()));

export const setApiKeyAction = async (input: unknown) =>
  change(async () => settings.setApiKey(await manage(), input, await getRequestMeta()));

export const removeApiKeyAction = async () =>
  change(async () => settings.removeApiKey(await manage(), await getRequestMeta()));

export const setProviderKeyAction = async (input: unknown) =>
  change(async () => settings.setProviderKey(await manage(), input, await getRequestMeta()));

export const removeProviderKeyAction = async (provider: string) =>
  change(async () => settings.removeProviderKey(await manage(), provider, await getRequestMeta()));

/** Tests a key by reading the provider's models (free; works while AI is off). */
export const testProviderKeyAction = async (provider: string) =>
  changeWith(async () =>
    settings.testProviderKey(await manage(), provider, await getRequestMeta()),
  );

export const readProviderModelsAction = async () =>
  changeWith(async () => settings.readProviderModels(await manage(), await getRequestMeta()));

export const setAgentModelAction = async (input: unknown) =>
  change(async () => settings.setAgentModel(await manage(), input, await getRequestMeta()));

export const setModelPriceAction = async (input: unknown) =>
  change(async () => prices.setModelPrice(await manage(), input, await getRequestMeta()));

/** Runs a task's test on a model (asks the model, so it costs a little and needs AI on). */
export const runModelTestAction = async (input: unknown) =>
  changeWith(async () => modelTests.runModelTest(await manage(), input, await getRequestMeta()));

export const setPinAction = async (input: unknown) =>
  change(async () => settings.setPin(await manage(), input, await getRequestMeta()));

export const setAssistantNameAction = async (input: unknown) =>
  change(async () => settings.setAssistantName(await manage(), input, await getRequestMeta()));

export const answerPermissionAction = async (requestId: string, input: unknown) =>
  change(async () =>
    requests.answerPermission(await manage(), requestId, input, await getRequestMeta()),
  );

export const answerDeletionAction = async (requestId: string, input: unknown) =>
  change(async () =>
    requests.answerDeletion(await manage(), requestId, input, await getRequestMeta()),
  );

// ---------------------------------------------------------------- agents and skills

export const getAgentsAction = async () =>
  runAction(async () => agentsScreen.getAgents(await view()));

export const setAgentOnAction = async (input: { agent: string; on: boolean }) =>
  change(async () => agentsScreen.setAgentOn(await manage(), input, await getRequestMeta()));

export const listSkillsAction = async (agent?: string) =>
  runAction(async () =>
    skills.listSkills(await view(), agent && /^[a-zA-Z0-9]{1,20}$/.test(agent) ? agent : undefined),
  );

export const getSkillAction = async (id: string) =>
  runAction(async () => skills.getSkill(await view(), String(id).slice(0, 60)));

export const createSkillAction = async (agent: string, input: unknown) =>
  changeWith(async () =>
    skills.createSkill(await manage(), String(agent), input, await getRequestMeta()),
  );

export const updateSkillAction = async (id: string, input: unknown) =>
  changeWith(async () => skills.updateSkill(await manage(), id, input, await getRequestMeta()));

/** Undo: an older version comes back as the newest. */
export const undoSkillAction = async (id: string, version: number) =>
  changeWith(async () => skills.undoSkill(await manage(), id, { version }, await getRequestMeta()));

export const setSkillOnAction = async (id: string, on: boolean) =>
  change(async () => skills.setSkillOn(await manage(), id, on === true, await getRequestMeta()));

/** A PDF or a photo of pages as the skill's knowledge (`file`). */
export const addSkillFileAction = async (id: string, form: FormData) =>
  changeWith(async () => {
    const ctx = await manage();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("VALIDATION", "Choose a PDF or a photo to add.");
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files can be up to 10 MB.");
    return skills.addSkillFile(
      ctx,
      id,
      { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
      await getRequestMeta(),
    );
  });

export const readSkillFileAction = async (id: string, fileId: string) =>
  changeWith(async () => skills.readSkillFile(await manage(), id, fileId, await getRequestMeta()));

export const removeSkillFileAction = async (id: string, fileId: string) =>
  changeWith(async () =>
    skills.removeSkillFile(await manage(), id, fileId, await getRequestMeta()),
  );

/** Starts the skill's test in the background (it asks the AI, so it costs a little). */
export const startSkillTestAction = async (id: string) =>
  change(async () => skills.startSkillTest(await manage(), id, await getRequestMeta()));
