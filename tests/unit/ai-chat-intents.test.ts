import { describe, expect, it } from "vitest";

import { dueIn, readIntent, refIn, storePrefix, westernDigits } from "@/modules/ai/chat/intents";

describe("reading the owner's chat commands", () => {
  it("reads Bengali digits and the dotted letters in one form", () => {
    expect(westernDigits("অর্ডার ২৬১১-০০২")).toBe("অর্ডার 2611-002");
    // য় typed as one character or as য + dot: both read the same.
    expect(readIntent("নিয়ম: কলার সবসময় 3 1/4 ইঞ্চি")).toEqual({
      kind: "teach",
      text: "কলার সবসময় 3 1/4 ইঞ্চি",
    });
    expect(readIntent("নিয়ম: কলার সবসময় 3 1/4 ইঞ্চি")).toMatchObject({ kind: "teach" });
  });

  it("reads the blueprint's commands as they are said", () => {
    expect(readIntent("সব থামাও")).toEqual({ kind: "ai.stop_all" });
    expect(readIntent("Stop everything")).toEqual({ kind: "ai.stop_all" });
    expect(readIntent("আবার চালু করো")).toEqual({ kind: "ai.resume" });
    expect(readIntent("অর্ডার ২৬১১-০০২-এর অবস্থা")).toEqual({
      kind: "order.status",
      ref: "2611-002",
    });
    expect(readIntent("Status of order SO-2026-0012")).toEqual({
      kind: "order.status",
      ref: "SO-2026-0012",
    });
    expect(readIntent("আজকের সেল রিপোর্ট PDF দাও")).toEqual({
      kind: "report.pdf",
      period: "today",
      report: "SALES",
      email: false,
    });
    expect(readIntent("গতকালের প্রফিট রিপোর্ট ইমেইলে পাঠাও")).toMatchObject({
      kind: "report.pdf",
      period: "yesterday",
      report: "PROFIT_AND_LOSS",
      email: true,
    });
    expect(readIntent("শেষ ৭ দিনের খরচ")).toEqual({ kind: "cost.summary", days: 7 });
    expect(readIntent("আজকের জন্য Accounts খুলে দাও")).toEqual({ kind: "control.accounts_today" });
    expect(readIntent("এই পলোর কস্টিং বের করো")).toEqual({ kind: "costing", ref: null });
    expect(readIntent("CS-2026-0003 কস্টিং")).toEqual({ kind: "costing", ref: "CS-2026-0003" });
    expect(readIntent("CS-2026-0003 profit 12.5%")).toEqual({
      kind: "profit.set",
      ref: "CS-2026-0003",
      percent: 12.5,
    });
    expect(readIntent("পুরোনো ড্রাফট বুকিংগুলো মুছে দাও")).toMatchObject({
      kind: "delete",
      oldDraftBookings: true,
    });
    expect(readIntent("সাপ্লায়ারকে নিজে পাঠাও, বায়ারকে খসড়া দাও")).toEqual({
      kind: "messaging.mode",
      supplier: "send",
    });
    expect(readIntent("পাঠাও")).toEqual({ kind: "draft.send" });
    expect(readIntent("নতুন অর্ডার")).toEqual({ kind: "order.new" });
    expect(readIntent("@X07 এনজাইম ওয়াশে শ্রিঙ্কেজ কত ধরব?")).toEqual({
      kind: "expert",
      expert: "X07",
      question: "এনজাইম ওয়াশে শ্রিঙ্কেজ কত ধরব?",
    });
  });

  it("reads tasks, follow-ups and drafts", () => {
    expect(readIntent("কাজ: বুকিং চেক করো, রহিমকে, কাল পর্যন্ত")).toEqual({
      kind: "task",
      title: "বুকিং চেক করো",
      who: "রহিম",
      due: "+1",
    });
    expect(readIntent("Task: Send the lab dips, Karim, by 2026-11-02")).toEqual({
      kind: "task",
      title: "Send the lab dips",
      who: "Karim",
      due: "2026-11-02",
    });
    // No person named: the day stays the day.
    expect(readIntent("কাজ: বুকিং চেক করো, কাল পর্যন্ত")).toEqual({
      kind: "task",
      title: "বুকিং চেক করো",
      who: null,
      due: "+1",
    });
    expect(readIntent("Task: Check the bookings, by 2026-12-01")).toEqual({
      kind: "task",
      title: "Check the bookings",
      who: null,
      due: "2026-12-01",
    });
    expect(readIntent("Follow up: Nordic Wear, in 3 days, PO 4501")).toEqual({
      kind: "follow_up",
      party: "Nordic Wear",
      due: "+3",
      about: "PO 4501",
    });
    expect(readIntent("Draft follow-up to Nordic Wear, about PO 4501")).toEqual({
      kind: "draft.write",
      party: "Nordic Wear",
      about: "PO 4501",
    });
  });

  it("leaves everything else to the AI", () => {
    expect(readIntent("এই অর্ডারে কাপড় কত কেজি লাগবে?").kind).toBe("free");
    expect(readIntent("What do you think of the new buyer?").kind).toBe("free");
    // A word with a hyphen is not an order number.
    expect(refIn("send the follow-up by e-mail")).toBeNull();
    expect(refIn("on 2026-10-15")).toBeNull();
  });

  it("reads days and the store prefix", () => {
    expect(dueIn("কাল")).toBe("+1");
    expect(dueIn("পরশু")).toBe("+2");
    expect(dueIn("2 সপ্তাহ পর")).toBe("+14");
    expect(dueIn("someday")).toBeNull();
    expect(storePrefix("EXTAS: আজকের সেল রিপোর্ট")).toEqual({
      store: "EXTAS",
      rest: "আজকের সেল রিপোর্ট",
    });
    expect(storePrefix("Rule: no overhead")).toEqual({ store: null, rest: "Rule: no overhead" });
  });
});
