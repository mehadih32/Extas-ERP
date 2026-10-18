import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  clip,
  draftVersion,
  MAX_TEXT,
  readButton,
  renderAnswer,
  renderDeletion,
  renderDraft,
  renderPermission,
} from "@/modules/ai/bot/render";
import { readTelegramUpdate, TELEGRAM_TOKEN } from "@/modules/ai/bot/telegram";
import { readWhatsAppPayload, whatsappSignatureOk } from "@/modules/ai/bot/whatsapp";
import { pinCandidates } from "@/modules/ai/pin-tries";

const ID = "cmabc123def456ghi";
const APP = "https://erp.test";

describe("Chat answers as bot messages", () => {
  it("keeps plain words and clips long ones", () => {
    expect(
      renderAnswer({ id: ID, text: "Working again.", card: null, cardStatus: null }, APP),
    ).toEqual({ text: "Working again.", buttons: [] });
    const long = clip("x".repeat(MAX_TEXT + 50));
    expect(long).toHaveLength(MAX_TEXT);
    expect(long.endsWith("…")).toBe(true);
  });

  it("gives a change card Apply and Cancel only while it waits", () => {
    const card = {
      type: "change" as const,
      action: "profit.set" as const,
      title: "Profit for CS-2026-0001",
      page: "Production > Costing",
      href: "/production/costing/x",
      lines: [{ label: "Profit %", before: "10", after: "12.5" }],
      params: {},
    };
    const open = renderAnswer(
      { id: ID, text: "Press Apply to set it.", card, cardStatus: "PROPOSED" },
      APP,
    );
    expect(open.text).toBe(
      "Press Apply to set it.\n\nProfit for CS-2026-0001 (Production > Costing)\n• Profit %: 10 → 12.5",
    );
    expect(open.buttons).toEqual([
      [
        { label: "Apply", data: `ap:${ID}` },
        { label: "Cancel", data: `cx:${ID}` },
      ],
    ]);
    const applied = renderAnswer({ id: ID, text: "", card, cardStatus: "APPLIED" }, APP);
    expect(applied.text.endsWith("Applied.")).toBe(true);
    expect(applied.buttons).toEqual([]);
  });

  it("gives a draft Send only when it has an address, and Discard always", () => {
    const draft = {
      type: "draft" as const,
      draftId: ID,
      subject: "Following up: PO 4501",
      to: null,
      party: "Nordic Wear AB",
      forBuyer: true,
      body: "Dear Nordic Wear AB,",
    };
    const buttons = (to: string | null) =>
      renderAnswer({ id: "m1", text: "", card: { ...draft, to }, cardStatus: null }, APP)
        .buttons.flat()
        .map((b) => b.label);
    expect(buttons(null)).toEqual(["Discard"]);
    expect(buttons("orders@nordicwear.test")).toEqual(["Send", "Discard"]);
  });

  it("sends a report as a file and links pages with the site's address", () => {
    const report = renderAnswer(
      {
        id: ID,
        text: "Sales report for 16 Oct 2026 is ready.",
        card: {
          type: "report",
          exportId: "exp1",
          title: "Sales report",
          range: "16 Oct 2026",
          href: "/reports/exports/exp1",
          emailed: null,
        },
        cardStatus: null,
      },
      APP,
    );
    expect(report.exportId).toBe("exp1");
    const requests = renderAnswer(
      {
        id: ID,
        text: "",
        card: { type: "requests", count: 2, what: "permission request", href: "/ai/control" },
        cardStatus: null,
      },
      `${APP}/`,
    );
    expect(requests.text).toBe(
      "2 permission requests waiting for you. https://erp.test/ai/control",
    );
  });

  it("asks a permission or deletion with its answers as buttons", () => {
    const permission = renderPermission({
      id: ID,
      task: "Send the PO to the factory",
      why: null,
      path: "Production > Bookings > Send",
    });
    expect(permission.text).toBe(
      "Permission request: Send the PO to the factory\nProduction > Bookings > Send",
    );
    expect(permission.buttons.flat().map((b) => readButton(b.data))).toEqual([
      { kind: "permission", requestId: ID, answer: "ONCE" },
      { kind: "permission", requestId: ID, answer: "TODAY" },
      { kind: "permission", requestId: ID, answer: "ALWAYS" },
      { kind: "permission", requestId: ID, answer: "REFUSED" },
    ]);
    const deletion = renderDeletion({
      id: ID,
      what: "Booking PO-1",
      why: "Empty",
      ifKept: "Nothing",
    });
    expect(deletion.text).toContain(
      "Approving (with your PIN) deletes it (cancels it) in your name",
    );
    expect(deletion.buttons.flat().map((b) => readButton(b.data))).toEqual([
      { kind: "deletion", requestId: ID, approve: true },
      { kind: "deletion", requestId: ID, approve: false },
    ]);
  });

  it("puts the draft's version on its Send button, and it changes when the draft does (v6.4.1)", () => {
    const draft = {
      draftId: ID,
      subject: "PO 4501",
      to: "orders@nordicwear.test",
      party: "Nordic Wear AB",
      forBuyer: true,
      body: "Hello",
    };
    const version = draftVersion(draft);
    expect(version).toMatch(/^[a-f0-9]{12}$/);
    const [send, discard] = renderDraft(draft).buttons.flat();
    expect(send!.data).toBe(`sd:${ID}:${version}`);
    expect(Buffer.byteLength(send!.data)).toBeLessThanOrEqual(64);
    expect(readButton(send!.data)).toEqual({ kind: "send", draftId: ID, version });
    expect(readButton(discard!.data)).toEqual({ kind: "discard", draftId: ID });
    for (const changed of [
      { ...draft, body: "Hello again" },
      { ...draft, subject: "PO 4502" },
      { ...draft, to: "other@nordicwear.test" },
    ]) {
      expect(draftVersion(changed)).not.toBe(version);
    }
    expect(readButton(`dd:${ID}:${version}`)).toBeNull();
    expect(readButton(`sd:${ID}:XYZ`)).toBeNull();
  });

  it("takes only numbers that stand alone for a possible PIN, never those inside codes (v6.4.1)", () => {
    expect(pinCandidates("CS-2026-0001 status")).toEqual([]);
    expect(pinCandidates("PO4501 and INV2026 and SO/2026/0112 and LOT_4455")).toEqual([]);
    expect(pinCandidates("অর্ডার4501")).toEqual([]);
    expect(pinCandidates("my pin is 2468, ok?")).toEqual(["2468"]);
    expect(pinCandidates("PIN:2468")).toEqual(["2468"]);
    expect(pinCandidates("PO 4501 is late, ship 2468.")).toEqual(["4501", "2468"]);
    expect(pinCandidates("123 and 123456789")).toEqual([]);
  });

  it("reads every button code back and nothing else", () => {
    expect(readButton(`sd:${ID}`)).toEqual({ kind: "send", draftId: ID });
    expect(readButton(`dd:${ID}`)).toEqual({ kind: "discard", draftId: ID });
    expect(readButton(`hr:${ID}:n`)).toEqual({ kind: "rule", ruleId: ID, approve: false });
    expect(readButton(`cx:${ID}`)).toEqual({ kind: "cancel", messageId: ID });
    for (const bad of [
      "",
      "ap:",
      `ap:${ID}:y`,
      `pr:${ID}:MAYBE`,
      "ap:short",
      `xx:${ID}`,
      `ap:${ID.toUpperCase()}`,
    ]) {
      expect(readButton(bad)).toBeNull();
    }
  });
});

describe("Telegram updates", () => {
  const owner = { id: 5001, first_name: "Mehadi", username: "mehadi" };

  it("reads a private message, and marks a group or someone else's chat as not private", () => {
    const m = readTelegramUpdate({
      update_id: 7,
      message: { message_id: 3, from: owner, chat: { id: 5001, type: "private" }, text: "status" },
    });
    expect(m).toMatchObject({
      updateId: "7",
      chatId: "5001",
      privateChat: true,
      fromName: "Mehadi @mehadi",
      messageId: "3",
      text: "status",
      media: null,
      callback: null,
    });
    expect(
      readTelegramUpdate({
        update_id: 8,
        message: { message_id: 4, from: owner, chat: { id: -100, type: "group" }, text: "status" },
      })?.privateChat,
    ).toBe(false);
    expect(
      readTelegramUpdate({
        update_id: 9,
        message: { message_id: 5, from: owner, chat: { id: 5001, type: "private" }, voice: {} },
      })?.media,
    ).toBe("voice");
  });

  it("reads a button press, and ignores what is not an update", () => {
    const press = readTelegramUpdate({
      update_id: 10,
      callback_query: {
        id: "cb1",
        from: owner,
        data: `ap:${ID}`,
        message: { message_id: 11, chat: { id: 5001, type: "private" } },
      },
    });
    expect(press).toMatchObject({
      chatId: "5001",
      privateChat: true,
      text: null,
      callback: { id: "cb1", data: `ap:${ID}`, messageId: "11" },
    });
    expect(readTelegramUpdate(null)).toBeNull();
    expect(readTelegramUpdate({ message: { text: "hi" } })).toBeNull();
    expect(readTelegramUpdate({ update_id: 1 })).toBeNull();
  });

  it("knows a bot token by its shape", () => {
    expect(TELEGRAM_TOKEN.test("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ")).toBe(true);
    expect(TELEGRAM_TOKEN.test("not a token")).toBe(false);
    expect(TELEGRAM_TOKEN.test("123456789:short")).toBe(false);
  });
});

describe("WhatsApp calls", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1098765" },
              contacts: [{ wa_id: "8801711000000", profile: { name: "Mehadi" } }],
              messages: [
                { id: "wamid.1", from: "8801711000000", type: "text", text: { body: "status" } },
                {
                  id: "wamid.2",
                  from: "8801711000000",
                  type: "interactive",
                  interactive: { button_reply: { id: `sd:${ID}`, title: "Send" } },
                },
                { id: "wamid.3", from: "8801711000000", type: "audio" },
              ],
            },
          },
        ],
      },
    ],
  };

  it("reads messages and button replies with the number they came to", () => {
    const [text, press, voice] = readWhatsAppPayload(payload);
    expect(text).toMatchObject({
      phoneNumberId: "1098765",
      updateId: "wamid.1",
      chatId: "8801711000000",
      fromName: "Mehadi",
      text: "status",
      callback: null,
    });
    expect(press?.callback).toEqual({ id: null, data: `sd:${ID}`, messageId: null });
    expect(voice?.media).toBe("voice");
    expect(readWhatsAppPayload({ entry: [{ changes: [{ value: { messages: [] } }] }] })).toEqual(
      [],
    );
  });

  it("accepts only calls signed with the app secret", () => {
    const body = JSON.stringify(payload);
    const signed = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(whatsappSignatureOk(body, signed, "app-secret")).toBe(true);
    expect(whatsappSignatureOk(body, signed, "another-secret")).toBe(false);
    expect(whatsappSignatureOk(`${body} `, signed, "app-secret")).toBe(false);
    expect(whatsappSignatureOk(body, null, "app-secret")).toBe(false);
    expect(whatsappSignatureOk(body, "sha256=abc", "app-secret")).toBe(false);
  });
});
