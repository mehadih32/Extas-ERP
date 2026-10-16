import type Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * v6.3 F: AI Center > Agents and Skills. Mehedi 2.0 heads the agents; the
 * owner switches the others off or on, and teaches any of them skills in
 * plain words. Every change is a version with undo; a skill is tested on its
 * examples (each answered by the agent, then marked) and the agent's work on
 * Do waits at Ask until the newest version passes. Skills join the agent's
 * instructions; a switched-off agent does no work. Only the owner changes
 * anything, never the AI.
 */

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { getAgents, setAgentOn } from "@/modules/ai/agents.service";
import { askClaude, standInForClaude } from "@/modules/ai/claude";
import { aiMay, setControlCell } from "@/modules/ai/control.service";
import { setAiSwitch, setApiKey } from "@/modules/ai/settings.service";
import {
  addSkillFile,
  createSkill,
  getSkill,
  listSkills,
  readSkillFile,
  removeSkillFile,
  runSkillTest,
  setSkillOn,
  startSkillTest,
  undoSkill,
  updateSkill,
} from "@/modules/ai/skills.service";
import { getFileForDownload } from "@/modules/files/file.service";
import { createRole } from "@/modules/rbac/role.service";

import { passAllBooks } from "../fixtures/ai-books";
import { claudeMessage } from "../fixtures/claude";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const KEY = "sk-ant-api03-test0123456789abcdWXYZ";
const CELL = "ai.production.techpack.draft";

async function expectAppError(promise: Promise<unknown>, code: string, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const join = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const watcherRole = await createRole(owner, {
    name: "AI Watcher",
    permissions: ["dashboard.view", "ai.view"],
  });
  await passAllBooks(company.id);
  return {
    company,
    owner,
    watcher: await join(watcherRole.id, "watcher"),
    pm: await join(roles.PRODUCTION_MANAGER, "pm"),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const SKILL = {
  name: "Polo GSM check",
  whenToUse: "যখন পোলো শার্টের ফ্যাব্রিক GSM দেখতে হবে",
  steps: "1. Read the GSM on the booking\n2. A pique polo needs 200 to 240 GSM",
  dos: "Name the booking",
  donts: "Never change the booking yourself",
  examples: [
    { situation: "A pique polo booking says 160 GSM.", answer: "Too light: ask for 200 to 240." },
    { situation: "A pique polo booking says 220 GSM.", answer: "Fine." },
  ],
  notes: "Buyer Nordic Wear wants 220 GSM.",
};

type Sent = { model: string; system: string; content: string; tools: string[] };

/** The AI: answers each example, and marks with `right` (all right unless told). */
function standIn(right: (n: number) => boolean = () => true, read = "Fabric: 220 GSM pique") {
  const sent: Sent[] = [];
  standInForClaude(async ({ body }) => {
    const system = Array.isArray(body.system)
      ? body.system.map((b) => b.text).join("\n")
      : (body.system ?? "");
    const first = body.messages[0]!.content;
    const content =
      typeof first === "string"
        ? first
        : first.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join(" ");
    const tools = (body.tools ?? []).map((t) => ("name" in t ? t.name : ""));
    sent.push({ model: body.model, system, content, tools });
    if (tools.includes("record_marks")) {
      const n = (content.match(/<q n="/g) ?? []).length;
      const block = {
        type: "tool_use",
        id: "toolu_marks",
        name: "record_marks",
        input: {
          marks: Array.from({ length: n }, (_, i) => ({
            n: i + 1,
            right: right(i + 1),
            why: right(i + 1) ? "Same decision" : "Missed the GSM range",
          })),
        },
      } as Anthropic.ToolUseBlock;
      return claudeMessage([block], body.model);
    }
    if (content.includes("Copy it out.")) return claudeMessage(read, body.model);
    return claudeMessage(`Answer to: ${content}`, body.model);
  });
  return sent;
}

async function switchOn(env: Env) {
  await setAiSwitch(env.owner, true);
  await setApiKey(env.owner, { key: KEY });
}

/** A small PDF as uploaded. */
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");

run("AI agents and skills", () => {
  let env: Env;
  let uploads: string;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-ai-skills-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    await resetDb();
    env = await setup();
  });
  afterEach(async () => {
    standInForClaude(null);
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("teaches a skill in plain words, versioned with undo; only the owner changes it", async () => {
    await expectAppError(listSkills(env.pm), "FORBIDDEN");
    await expectAppError(createSkill(env.watcher, "X05", SKILL), "FORBIDDEN", /Only the owner/);
    await expectAppError(createSkill(env.owner, "nobody", SKILL), "VALIDATION", /Pick the agent/);
    await expect(createSkill(env.owner, "X05", { ...SKILL, name: "" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      createSkill(env.owner, "X05", {
        ...SKILL,
        examples: Array.from({ length: 13 }, () => SKILL.examples[0]),
      }),
    ).rejects.toBeInstanceOf(ZodError);

    const { id } = await createSkill(env.owner, "X05", SKILL);
    let skill = await getSkill(env.watcher, id);
    expect(skill).toMatchObject({
      agent: "X05",
      on: true,
      can: { manage: false },
      newest: {
        version: 1,
        name: "Polo GSM check",
        whenToUse: SKILL.whenToUse,
        examples: SKILL.examples,
        change: "Written",
        by: "owner",
        test: { standing: "UNTESTED", text: "Not tested", status: null },
      },
    });
    expect(skill.agentName).toMatch(/^X05 /);

    // The same words make no new version.
    expect(await updateSkill(env.owner, id, SKILL)).toEqual({ version: 1, changed: false });
    expect(
      await updateSkill(env.owner, id, {
        ...SKILL,
        steps: `${SKILL.steps}\n3. A jersey polo needs 160 to 180`,
        change: "Jersey too",
      }),
    ).toEqual({ version: 2, changed: true });
    await expectAppError(updateSkill(env.watcher, id, SKILL), "FORBIDDEN");

    expect(await undoSkill(env.owner, id, { version: 1 })).toEqual({ version: 3 });
    await expectAppError(undoSkill(env.owner, id, { version: 3 }), "VALIDATION", /in use/);
    await expectAppError(undoSkill(env.owner, id, { version: 9 }), "NOT_FOUND");
    skill = await getSkill(env.owner, id);
    expect(skill.newest.steps).toBe(SKILL.steps);
    expect(skill.versions.map((v) => [v.version, v.change])).toEqual([
      [3, "Undo: back to version 1"],
      [2, "Jersey too"],
      [1, "Written"],
    ]);

    // Off keeps it (never deleted); the list shows where each skill stands.
    await setSkillOn(env.owner, id, false);
    const list = await listSkills(env.watcher, "X05");
    expect(list.agents[0]).toMatchObject({ key: "mehedi" });
    expect(list.skills).toEqual([
      expect.objectContaining({ id, on: false, version: 3, examples: 2, files: 0 }),
    ]);
    expect((await listSkills(env.watcher, "X01")).skills).toEqual([]);

    const log = await prisma.auditLog.findMany({
      where: { entityType: "AiSkill", entityId: id },
      orderBy: { createdAt: "asc" },
      select: { summary: true, userId: true },
    });
    expect(log.map((l) => l.summary)).toEqual([
      expect.stringMatching(/^Taught X05 .+ a new skill: Polo GSM check$/),
      "Changed the skill Polo GSM check: version 2 (Jersey too)",
      "Undid the skill Polo GSM check back to version 1 (now version 3)",
      "Switched the skill Polo GSM check off",
    ]);
    expect(log.every((l) => l.userId === env.owner.user.id)).toBe(true);
  });

  it("tests a skill on its examples, holds Do at Ask until it passes, and undo keeps the pass", async () => {
    await switchOn(env);
    await setControlCell(env.owner, { node: `k:${CELL}`, state: "DO" });
    expect((await aiMay(env.company.id, CELL)).state).toBe("DO");

    const { id } = await createSkill(env.owner, "X05", SKILL);
    // A skill not passed yet: the expert's tech pack work asks first.
    expect(await aiMay(env.company.id, CELL)).toMatchObject({
      state: "ASK",
      why: expect.stringContaining('Do waits for the skill "Polo GSM check" to pass its test'),
    });
    // Work the expert does not do is not held.
    expect((await aiMay(env.company.id, "ai.hr.notice.draft")).why ?? "").not.toContain(
      "Do waits for the skill",
    );

    await expectAppError(startSkillTest(env.watcher, id), "FORBIDDEN");
    const sent = standIn((n) => n !== 2);
    await startSkillTest(env.owner, id);
    await expectAppError(startSkillTest(env.owner, id), "CONFLICT", /running already/);
    const job = await prisma.backgroundJob.findFirstOrThrow({ where: { kind: "ai.skill.test" } });
    expect(job.maxAttempts).toBe(1);
    let skill = await getSkill(env.owner, id);
    expect(skill.newest.test).toMatchObject({ status: "RUNNING", text: "Testing now" });

    const versionId = (job.payload as { versionId: string }).versionId;
    await runSkillTest(versionId, env.owner.user.id);
    skill = await getSkill(env.owner, id);
    expect(skill.newest.test).toMatchObject({
      status: "DONE",
      standing: "FAILED",
      text: "Not passed",
    });
    expect(skill.newest.test.lines.map((l) => [l.situation, l.right, l.why])).toEqual([
      [SKILL.examples[0]!.situation, true, "Same decision"],
      [SKILL.examples[1]!.situation, false, "Missed the GSM range"],
    ]);
    // Each example went to the expert with its skill in its instructions,
    // then one marking call.
    expect(sent).toHaveLength(3);
    expect(sent[0]!.content).toBe(SKILL.examples[0]!.situation);
    expect(sent[0]!.system).toContain("### Skill: Polo GSM check (version 1)");
    expect(sent[0]!.system).toContain("Buyer Nordic Wear wants 220 GSM.");
    expect(sent[2]!.tools).toEqual(["record_marks"]);
    expect(sent[2]!.system).not.toContain("### Skill:");
    expect((await aiMay(env.company.id, CELL)).state).toBe("ASK");

    const lines = await prisma.aiUsage.findMany({
      orderBy: { createdAt: "asc" },
      select: { agent: true, task: true, screen: true },
    });
    expect(lines).toEqual([
      { agent: expect.stringMatching(/^X05 /), task: "chat", screen: `/ai/skills/${id}` },
      { agent: expect.stringMatching(/^X05 /), task: "chat", screen: `/ai/skills/${id}` },
      { agent: "Skill test marker", task: "knowledge.test", screen: `/ai/skills/${id}` },
    ]);

    // Version 2 passes: Do is Do again.
    await updateSkill(env.owner, id, { ...SKILL, notes: "Nordic Wear: 220 GSM, ±5%" });
    standIn();
    await startSkillTest(env.owner, id);
    const second = await prisma.backgroundJob.findFirstOrThrow({
      where: { kind: "ai.skill.test", id: { not: job.id } },
    });
    await runSkillTest((second.payload as { versionId: string }).versionId, env.owner.user.id);
    expect((await getSkill(env.owner, id)).newest.test).toMatchObject({
      standing: "PASSED",
      text: "Passed",
    });
    expect((await aiMay(env.company.id, CELL)).state).toBe("DO");

    // A change is tested again; undo to the passed words brings the pass back.
    await updateSkill(env.owner, id, { ...SKILL, dos: "Name the booking and the buyer" });
    expect((await aiMay(env.company.id, CELL)).state).toBe("ASK");
    expect(await undoSkill(env.owner, id, { version: 2 })).toEqual({ version: 4 });
    expect((await getSkill(env.owner, id)).newest.test.standing).toBe("PASSED");
    expect((await aiMay(env.company.id, CELL)).state).toBe("DO");
    // Undo to the version that failed brings its "not passed" back too.
    await undoSkill(env.owner, id, { version: 1 });
    expect((await aiMay(env.company.id, CELL)).state).toBe("ASK");

    // A skill switched off, or an agent switched off, holds nothing.
    await setSkillOn(env.owner, id, false);
    expect((await aiMay(env.company.id, CELL)).state).toBe("DO");
    await setSkillOn(env.owner, id, true);
    await setAgentOn(env.owner, { agent: "X05", on: false });
    expect((await aiMay(env.company.id, CELL)).state).toBe("DO");

    // With no examples there is nothing to test.
    const bare = await createSkill(env.owner, "X01", { ...SKILL, name: "Bare", examples: [] });
    await expectAppError(startSkillTest(env.owner, bare.id), "VALIDATION", /Add at least one/);
    expect((await getSkill(env.owner, bare.id)).newest.test.text).toBe("Add an example to test it");
  });

  it("refuses to start a test while AI is off, and a failed run says why", async () => {
    const { id } = await createSkill(env.owner, "help", SKILL);
    await expectAppError(startSkillTest(env.owner, id), "UNAVAILABLE", /switched off/);
    await switchOn(env);
    standInForClaude(async ({ body }) =>
      claudeMessage(body.tools?.length ? "No tool used." : "An answer", body.model),
    );
    await startSkillTest(env.owner, id);
    const job = await prisma.backgroundJob.findFirstOrThrow({ where: { kind: "ai.skill.test" } });
    await runSkillTest((job.payload as { versionId: string }).versionId, null);
    expect((await getSkill(env.owner, id)).newest.test).toMatchObject({
      status: "FAILED",
      error: "The marking could not be read. Run the test again.",
      standing: "UNTESTED",
    });
  });

  it("puts the skills that are on into the agent's instructions; an agent switched off does no work", async () => {
    await switchOn(env);
    const sent = standIn();
    const help = await createSkill(env.owner, "help", { ...SKILL, name: "Answer in short" });
    const off = await createSkill(env.owner, "help", { ...SKILL, name: "Old way" });
    await setSkillOn(env.owner, off.id, false);
    await createSkill(env.owner, "X05", { ...SKILL, name: "Expert only" });
    const ask = (agent: string, task: "help.answer" | "chat" = "help.answer") =>
      askClaude(env.company.id, {
        task,
        agent,
        why: "Help question",
        system: "You are the Help AI.",
        maxTokens: 200,
        messages: [{ role: "user", content: "How do I add a buyer?" }],
      });
    await ask("Help AI");
    expect(sent[0]!.system).toMatch(/^You are the Help AI\./);
    expect(sent[0]!.system).toContain("Skills the owner taught you.");
    expect(sent[0]!.system).toContain("### Skill: Answer in short (version 1)");
    expect(sent[0]!.system).not.toContain("Old way");
    expect(sent[0]!.system).not.toContain("Expert only");
    // An agent without skills gets its instructions as they are.
    await ask("Mehedi 2.0", "chat");
    expect(sent[1]!.system).toBe("You are the Help AI.");
    expect(help.id).toBeTruthy();

    await expectAppError(setAgentOn(env.watcher, { agent: "help", on: false }), "FORBIDDEN");
    await expectAppError(
      setAgentOn(env.owner, { agent: "mehedi", on: false }),
      "VALIDATION",
      /follows the main switch/,
    );
    await expectAppError(setAgentOn(env.owner, { agent: "X99", on: false }), "NOT_FOUND");
    await setAgentOn(env.owner, { agent: "help", on: false });
    await expectAppError(
      ask("Help AI"),
      "UNAVAILABLE",
      "Help AI is switched off. The owner turns it on in AI Center > Agents.",
    );
    expect(sent).toHaveLength(2);
    // Mehedi 2.0 and the other agents still work.
    await ask("Mehedi 2.0", "chat");
    await setAgentOn(env.owner, { agent: "help", on: true });
    await ask("Help AI");
    expect(sent).toHaveLength(4);
    expect(
      await prisma.auditLog.count({
        where: {
          summary: {
            in: ["Switched the AI agent Help AI off", "Switched the AI agent Help AI on"],
          },
        },
      }),
    ).toBe(2);
  });

  it("keeps PDFs and photos as knowledge: the AI reads them once, and takes them out as a version", async () => {
    const { id } = await createSkill(env.owner, "X05", SKILL);
    await expectAppError(
      addSkillFile(env.watcher, id, { fileName: "gsm.pdf", bytes: PDF }),
      "FORBIDDEN",
    );
    await expectAppError(
      addSkillFile(env.owner, id, { fileName: "notes.txt", bytes: Buffer.from("plain text") }),
      "VALIDATION",
      /photo .* or a PDF/,
    );
    // AI off: kept, read later with "Read".
    const added = await addSkillFile(env.owner, id, { fileName: "gsm.pdf", bytes: PDF });
    expect(added).toMatchObject({ version: 2, read: false });
    let skill = await getSkill(env.owner, id);
    expect(skill.newest.files).toEqual([{ fileId: added.fileId, name: "gsm.pdf", text: null }]);
    expect(skill.newest.change).toBe("Added the file gsm.pdf");

    // The people who see the AI Center open it; others do not.
    expect((await getFileForDownload(env.watcher, added.fileId)).asset.fileName).toBe("gsm.pdf");
    await expectAppError(getFileForDownload(env.pm, added.fileId), "FORBIDDEN");

    await switchOn(env);
    const sent = standIn(() => true, "Pique polo: 220 GSM, 100% cotton");
    expect(await readSkillFile(env.owner, id, added.fileId)).toEqual({ characters: 32 });
    expect(sent[0]!.content).toContain("[document]");
    skill = await getSkill(env.owner, id);
    expect(skill.newest.version).toBe(2);
    expect(skill.newest.files[0]!.text).toBe("Pique polo: 220 GSM, 100% cotton");
    const line = await prisma.aiUsage.findFirstOrThrow({ where: { agent: "Skill reader" } });
    expect(line).toMatchObject({ task: "read.documents", screen: `/ai/skills/${id}` });

    // What it read is the agent's knowledge.
    await askClaude(env.company.id, {
      task: "chat",
      agent: skill.agentName,
      why: "Expert question",
      system: "You are X05.",
      maxTokens: 200,
      messages: [{ role: "user", content: "GSM?" }],
    });
    expect(sent.at(-1)!.system).toContain("From the file gsm.pdf:\nPique polo: 220 GSM");

    // AI on: a new file is read at once.
    const photo = await addSkillFile(env.owner, id, {
      fileName: "page.pdf",
      bytes: Buffer.concat([PDF, Buffer.from("% page 2\n")]),
    });
    expect(photo).toMatchObject({ version: 3, read: true });

    expect(await removeSkillFile(env.owner, id, added.fileId)).toEqual({ version: 4 });
    await expectAppError(removeSkillFile(env.owner, id, added.fileId), "NOT_FOUND");
    skill = await getSkill(env.owner, id);
    expect(skill.newest.files.map((f) => f.name)).toEqual(["page.pdf"]);
    // Undo brings the file back, with what the AI read.
    await undoSkill(env.owner, id, { version: 3 });
    expect((await getSkill(env.owner, id)).newest.files.map((f) => [f.name, !!f.text])).toEqual([
      ["gsm.pdf", true],
      ["page.pdf", true],
    ]);
  });

  it("shows Mehedi 2.0 at the top and every agent under him with model, cells, skills, cost and runs", async () => {
    await expectAppError(getAgents(env.pm), "FORBIDDEN");
    let screen = await getAgents(env.watcher);
    expect(screen.aiState).toBe("switched-off");
    expect(screen.can.manage).toBe(false);
    expect(screen.agents[0]).toMatchObject({
      key: "mehedi",
      head: true,
      name: "Mehedi 2.0",
      on: false,
      switchedOff: false,
      model: { each: true },
      cells: { every: expect.objectContaining({ DO: expect.any(Number) }), list: [] },
    });
    expect(screen.agents[0]!.books.length).toBeGreaterThan(0);
    expect(screen.agents.map((a) => a.key)).toEqual(
      expect.arrayContaining(["X01", "X05", "orchestrator", "review", "help"]),
    );

    await switchOn(env);
    standIn();
    const { id } = await createSkill(env.owner, "X01", SKILL);
    await setAgentOn(env.owner, { agent: "review", on: false });
    await askClaude(env.company.id, {
      task: "chat",
      agent: "X01 Tech pack lead",
      why: "Answer the factory",
      system: "You are X01.",
      maxTokens: 200,
      messages: [{ role: "user", content: "Hi" }],
    });
    screen = await getAgents(env.owner);
    expect(screen.aiState).toBe("on");
    const x01 = screen.agents.find((a) => a.key === "X01")!;
    expect(x01).toMatchObject({
      head: false,
      on: true,
      skills: [{ id, name: "Polo GSM check", version: 1, standing: "UNTESTED", on: true }],
      today: { calls: 1 },
      month: { calls: 1 },
      last: [expect.objectContaining({ why: "Answer the factory", result: "OK" })],
    });
    expect(x01.cells.list.map((c) => c.key)).toEqual([CELL, "ai.production.booking.send"]);
    expect(x01.model.provider).toBe("Claude");
    expect(screen.agents.find((a) => a.key === "review")).toMatchObject({
      on: false,
      switchedOff: true,
    });
    expect(screen.agents.find((a) => a.key === "help")!.cells.list).toEqual([]);
  });
});
