import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-cookie";
import { REQUESTED_PATH_HEADER, safeNextPath, signInPath } from "@/lib/routes";
import { config, proxy } from "@/proxy";

describe("where sign-in may send people afterwards", () => {
  it("keeps paths inside the app, with their query and anchor", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/sales?tab=open#latest")).toBe("/sales?tab=open#latest");
    expect(safeNextPath("/?period=this-month&group=style")).toBe("/?period=this-month&group=style");
    expect(safeNextPath("/change-password")).toBe("/change-password");
  });

  it("refuses other sites, however the link is dressed up", () => {
    for (const value of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "http:/evil.example",
      "evil.example",
      "javascript:alert(1)",
      "/\tevil",
      "/\nevil",
      " /sales",
    ]) {
      expect(safeNextPath(value), value).toBeNull();
    }
  });

  it("refuses screens that would loop, and anything that is not a short string", () => {
    expect(safeNextPath("/sign-in")).toBeNull();
    expect(safeNextPath("/sign-in?next=/sales")).toBeNull();
    expect(safeNextPath("/select-company")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(["/sales"])).toBeNull();
    expect(safeNextPath(`/${"a".repeat(512)}`)).toBeNull();
  });

  it("builds the sign-in address, leaving out the dashboard and unsafe paths", () => {
    expect(signInPath("/?period=this-month")).toBe("/sign-in?next=%2F%3Fperiod%3Dthis-month");
    expect(signInPath("/sales/12")).toBe("/sign-in?next=%2Fsales%2F12");
    expect(signInPath("/")).toBe("/sign-in");
    expect(signInPath("//evil.example")).toBe("/sign-in");
    expect(signInPath(null)).toBe("/sign-in");
    expect(signInPath()).toBe("/sign-in");
  });
});

describe("the proxy in front of the screens", () => {
  const request = (path: string, init: { method?: string; cookie?: string } = {}) =>
    new NextRequest(`http://erp.test${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.cookie ? { cookie: `${SESSION_COOKIE}=${init.cookie}` } : {}),
        // A browser trying to choose where a later sign-in sends it.
        [REQUESTED_PATH_HEADER]: "//evil.example",
      },
    });
  const passedOn = (response: Response) => response.headers.get("x-middleware-next") === "1";
  const requestedPath = (response: Response) =>
    response.headers.get(`x-middleware-request-${REQUESTED_PATH_HEADER}`);

  it("sends visitors without a session to sign in, remembering the page", () => {
    const response = proxy(request("/?period=this-month&group=style"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/?period=this-month&group=style");
  });

  it("does not add the dashboard as the page to come back to", () => {
    const location = new URL(proxy(request("/")).headers.get("location")!);
    expect(location.pathname + location.search).toBe("/sign-in");
  });

  it("lets the sign-in screen and Server Actions through without a session", () => {
    expect(passedOn(proxy(request("/sign-in")))).toBe(true);
    expect(passedOn(proxy(request("/sign-in?next=%2Fsales")))).toBe(true);
    expect(passedOn(proxy(request("/", { method: "POST" })))).toBe(true);
  });

  it("renews the session cookie on each visit and tells the screen which page was asked for", () => {
    const response = proxy(request("/?period=this-month", { cookie: "token-1" }));
    expect(passedOn(response)).toBe(true);
    expect(requestedPath(response)).toBe("/?period=this-month");
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie).toMatchObject({
      value: "token-1",
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("leaves the cookie alone on Server Actions, which set or clear it themselves", () => {
    const response = proxy(request("/", { method: "POST", cookie: "token-1" }));
    expect(passedOn(response)).toBe(true);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("runs for screens only, not the API, Next.js' files or the icon", () => {
    const [pattern] = config.matcher;
    const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);
    for (const path of ["/", "/sign-in", "/sales/12", "/select-company"]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of ["/api/me", "/api/auth/login", "/_next/static/app.js", "/icon.svg"]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
