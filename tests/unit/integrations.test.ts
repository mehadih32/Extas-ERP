import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { providerOf } from "@/modules/integrations/config";
import { mapLink, mapsBrowserKey, mapsStatus } from "@/modules/integrations/maps";
import {
  checkPayout,
  payoutGateway,
  payoutStatus,
  sendPayout,
} from "@/modules/integrations/payouts";
import { pushSender, pushStatus, pushToUsers } from "@/modules/integrations/push";
import { bdMobile, fillTemplate, sendSms, smsGateway, smsStatus } from "@/modules/integrations/sms";
import { integrationStatus } from "@/modules/integrations/status";

/*
 * The outside-service plugs: each is off until its server settings are added,
 * says what is wrong with settings that cannot work, and plugs in by settings
 * alone. "log" is a test mode that sends nothing.
 */

const sent = (response: { status?: number; body?: string } = {}) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(response.body ?? "OK 1234", { status: response.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe("the plugs' settings", () => {
  it("are all off with no settings", () => {
    expect(integrationStatus({}).map((p) => [p.key, p.state, p.problem])).toEqual([
      ["sms", "OFF", null],
      ["push", "OFF", null],
      ["payouts", "OFF", null],
      ["maps", "OFF", null],
    ]);
    expect(smsGateway({})).toBeNull();
    expect(pushSender({})).toBeNull();
    expect(payoutGateway({})).toBeNull();
    expect(mapsBrowserKey({})).toBeNull();
  });

  it("read a provider from its choices, and say what is wrong otherwise", () => {
    expect(providerOf({ X: " LOG " }, "X", ["log", "http"])).toEqual({
      provider: "log",
      problem: null,
    });
    expect(providerOf({ X: "off" }, "X", ["log"])).toEqual({ provider: null, problem: null });
    expect(providerOf({ X: "twilio" }, "X", ["log", "http"])).toEqual({
      provider: null,
      problem: "X must be off, log or http.",
    });
    expect(smsStatus({ SMS_PROVIDER: "carrier-pigeon" })).toMatchObject({
      state: "OFF",
      problem: "SMS_PROVIDER must be off, log or http.",
    });
  });

  it("switch on test mode and the real services by settings alone", () => {
    expect(smsStatus({ SMS_PROVIDER: "log" }).state).toBe("TEST");
    expect(pushStatus({ PUSH_PROVIDER: "log" }).state).toBe("TEST");
    expect(payoutStatus({ PAYOUT_PROVIDER: "log" }).state).toBe("TEST");
    expect(mapsStatus({ GOOGLE_MAPS_API_KEY: "AIza-test" })).toMatchObject({
      state: "ON",
      provider: "google",
    });
    expect(mapsBrowserKey({ GOOGLE_MAPS_API_KEY: " AIza-test " })).toBe("AIza-test");
    expect(
      smsStatus({ SMS_PROVIDER: "http", SMS_HTTP_URL: "https://sms.example/send?to={to}" }).state,
    ).toBe("ON");
  });

  it("refuse an HTTP gateway set up wrongly", () => {
    expect(smsStatus({ SMS_PROVIDER: "http" }).problem).toMatch(/SMS_HTTP_URL/);
    expect(smsStatus({ SMS_PROVIDER: "http", SMS_HTTP_URL: "sms.example" }).problem).toMatch(
      /SMS_HTTP_URL/,
    );
    const url = "https://sms.example/send";
    expect(
      smsStatus({ SMS_PROVIDER: "http", SMS_HTTP_URL: url, SMS_HTTP_METHOD: "PUT" }).problem,
    ).toMatch(/GET or POST/);
    expect(
      smsStatus({ SMS_PROVIDER: "http", SMS_HTTP_URL: url, SMS_HTTP_METHOD: "post" }).problem,
    ).toMatch(/SMS_HTTP_BODY/);
    expect(smsGateway({ SMS_PROVIDER: "http" })).toBeNull();
  });
});

describe("SMS", () => {
  it("reads Bangladeshi mobile numbers however they are typed", () => {
    for (const typed of ["01711-000000", "+880 1711 000000", "8801711000000", "(017) 11000000"]) {
      expect(bdMobile(typed), typed).toBe("01711000000");
    }
    for (const typed of ["01211000000", "1711000000", "017110000001", "02-9876543"]) {
      expect(bdMobile(typed), typed).toBeNull();
    }
  });

  it("fills a gateway's address, making each value safe", () => {
    expect(
      fillTemplate(
        "https://x/?to={to}&msg={text}&keep={unknown}",
        { to: "880", text: "a&b c" },
        encodeURIComponent,
      ),
    ).toBe("https://x/?to=880&msg=a%26b%20c&keep={unknown}");
  });

  it("sends through a GET gateway with the number, text, sender and key filled in", async () => {
    const { fetch, calls } = sent();
    const gateway = smsGateway(
      {
        SMS_PROVIDER: "http",
        SMS_HTTP_URL:
          "https://sms.example/api?key={key}&to={to}&local={to_local}&from={sender}&msg={text}",
        SMS_API_KEY: "k#1",
        SMS_SENDER_ID: "EXTAS",
      },
      fetch,
    )!;
    expect(await gateway.send({ to: "01711-000000", text: "Code 123456" })).toEqual({
      ok: true,
      providerMessageId: "OK 1234",
    });
    expect(calls[0]!.url).toBe(
      "https://sms.example/api?key=k%231&to=8801711000000&local=01711000000&from=EXTAS&msg=Code%20123456",
    );
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.body).toBeUndefined();
    expect(await gateway.send({ to: "12345", text: "x" })).toEqual({
      ok: false,
      error: "Not a Bangladeshi mobile number.",
    });
    expect(calls).toHaveLength(1);
  });

  it("posts JSON or a form, and checks the gateway's answer", async () => {
    const json = sent();
    await smsGateway(
      {
        SMS_PROVIDER: "http",
        SMS_HTTP_URL: "https://sms.example/send",
        SMS_HTTP_METHOD: "POST",
        SMS_HTTP_BODY: '{"to":"{to}","message":"{text}"}',
      },
      json.fetch,
    )!.send({ to: "01711000000", text: 'Say "hi"\nnow' });
    expect(json.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(json.calls[0]!.init.body))).toEqual({
      to: "8801711000000",
      message: 'Say "hi"\nnow',
    });
    expect((json.calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );

    const form = sent({ body: '{"response_code":1003,"error":"low balance"}' });
    const gateway = smsGateway(
      {
        SMS_PROVIDER: "http",
        SMS_HTTP_URL: "https://sms.example/send",
        SMS_HTTP_METHOD: "POST",
        SMS_HTTP_BODY: "to={to}&message={text}",
        SMS_HTTP_SUCCESS: '"response_code":202',
      },
      form.fetch,
    )!;
    const result = await gateway.send({ to: "01711000000", text: "a&b" });
    expect(String(form.calls[0]!.init.body)).toBe("to=8801711000000&message=a%26b");
    // The gateway answered 200 without the success text: not sent.
    expect(result.ok).toBe(false);

    const refused = sent({ status: 401, body: "bad key" });
    expect(
      (
        await smsGateway(
          { SMS_PROVIDER: "http", SMS_HTTP_URL: "https://sms.example/send?to={to}" },
          refused.fetch,
        )!.send({ to: "01711000000", text: "x" })
      ).ok,
    ).toBe(false);
  });

  it("is refused while off, and logs what it sends without the hidden text", async () => {
    const db = { notificationLog: { create: vi.fn(async () => ({})) } };
    await expect(
      sendSms(
        db as never,
        "c1",
        { to: "01711000000", text: "Code 123456", keep: "Code ••••••" },
        null,
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(db.notificationLog.create).not.toHaveBeenCalled();

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await sendSms(
      db as never,
      "c1",
      { to: "+8801711000000", text: "Code 123456", keep: "Code ••••••", employeeId: "e1" },
      smsGateway({ SMS_PROVIDER: "log" }),
    );
    expect(result.ok).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Code 123456"));
    info.mockRestore();
    expect(db.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: "c1",
        channel: "SMS",
        recipient: "01711000000",
        body: "Code ••••••",
        employeeId: "e1",
        status: "SENT",
      }),
    });
  });
});

describe("push notifications", () => {
  it("do nothing while off, and reach each user once in test mode", async () => {
    expect(await pushToUsers(["u1"], { title: "New task", body: "Cut fabric" }, null)).toEqual({
      sent: 0,
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sender = pushSender({ PUSH_PROVIDER: "log" });
    expect(await pushToUsers(["u1", "u2", "u1"], { title: "New task", body: "x" }, sender)).toEqual(
      {
        sent: 2,
      },
    );
    expect(info).toHaveBeenCalledTimes(2);
    info.mockRestore();
  });
});

describe("wallet payouts", () => {
  it("check the wallet number and the amount before anything goes", () => {
    const base = { wallet: "BKASH" as const, reference: "SAL-2026-10 EMP-0007" };
    expect(checkPayout({ ...base, to: "+880 1711-000000", amount: "1500.00" }).to).toBe(
      "01711000000",
    );
    expect(() => checkPayout({ ...base, to: "12345", amount: "10" })).toThrow(AppError);
    for (const amount of ["0", "-5", "1.234", "abc"]) {
      expect(() => checkPayout({ ...base, to: "01711000000", amount }), amount).toThrow(AppError);
    }
  });

  it("are refused while off, and send nothing in test mode", async () => {
    const request = { wallet: "NAGAD" as const, to: "01711000000", amount: "500", reference: "R1" };
    await expect(sendPayout(request, null)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await sendPayout(request, payoutGateway({ PAYOUT_PROVIDER: "log" }));
    expect(result).toMatchObject({ ok: true, test: true });
    info.mockRestore();
  });
});

describe("maps", () => {
  it("links to a place on Google Maps without a key", () => {
    expect(mapLink(23.8103, 90.4125)).toBe(
      "https://www.google.com/maps/search/?api=1&query=23.810300,90.412500",
    );
  });
});
