import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  fillRoute,
  isFixedRoute,
  pdfProblem,
  screenProblem,
  screenRoutes,
} from "../../scripts/update-checks";

describe("the check after an update", () => {
  const routes = screenRoutes(join(process.cwd(), "src", "app", "(app)"));

  it("finds every screen from the page files, without the (app) group in the address", () => {
    expect(routes).toContain("/");
    expect(routes).toContain("/production/bookings");
    expect(routes).toContain("/production/bookings/[bookingId]");
    expect(routes.every((r) => r.startsWith("/") && !r.includes("("))).toBe(true);
    expect(routes.filter(isFixedRoute)).not.toContain("/production/bookings/[bookingId]");
  });

  it("fills a record's id into its screen, and skips screens with no record yet", () => {
    expect(fillRoute("/parties/[list]/[partyId]", { list: "buyers", partyId: "p 1" })).toBe(
      "/parties/buyers/p%201",
    );
    expect(fillRoute("/production/bookings/[bookingId]", {})).toBeNull();
  });

  it("tells a working screen from an error, the sign-in screen or a failed server part", () => {
    const url = "http://app:3000/production";
    expect(screenProblem({ status: 200, url, body: "<html>ok</html>" })).toBeNull();
    // "Not found" and redirects carry a word in the digest, not a number.
    expect(
      screenProblem({
        status: 200,
        url,
        body: '<template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404">',
      }),
    ).toBeNull();
    expect(screenProblem({ status: 500, url, body: "" })).toBe("answered 500");
    expect(
      screenProblem({ status: 200, url: "http://app:3000/sign-in?next=%2F", body: "" }),
    ).toMatch(/sign-in/);
    expect(screenProblem({ status: 200, url, body: '<template data-dgst="1234567890">' })).toMatch(
      /error screen/,
    );
    expect(screenProblem({ status: 200, url, body: '0:{\\"digest\\":\\"3456\\"}' })).toMatch(
      /error screen/,
    );
  });

  it("only takes a real PDF as a printed PDF", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    expect(pdfProblem({ status: 200, type: "application/pdf", bytes: pdf })).toBeNull();
    expect(pdfProblem({ status: 200, type: "text/html", bytes: pdf })).toMatch(/instead of a PDF/);
    expect(pdfProblem({ status: 403, type: "application/json", bytes: pdf })).toBe("answered 403");
    expect(
      pdfProblem({
        status: 200,
        type: "application/pdf",
        bytes: new TextEncoder().encode("<html>"),
      }),
    ).toMatch(/not a PDF/);
  });
});

describe("deploy.sh", () => {
  const deploy = readFileSync("deploy/deploy.sh", "utf8");
  const lib = readFileSync("deploy/lib.sh", "utf8");

  it("keeps the running version before building, and builds before touching anything", () => {
    const keep = deploy.indexOf("keep_running_version");
    const build = deploy.indexOf('compose "${build[@]}"');
    const copy = deploy.indexOf("safety_copy");
    const up = deploy.indexOf("compose up -d --remove-orphans");
    expect(keep).toBeGreaterThan(0);
    expect(keep).toBeLessThan(build);
    expect(build).toBeLessThan(copy);
    expect(copy).toBeLessThan(up);
  });

  it("goes back by itself when the update does not start or a screen fails", () => {
    expect(deploy).toMatch(/go_back "the database could not be brought up to date/);
    expect(deploy).toMatch(/wait_healthy app; then[\s\S]*?go_back "the new version did not start"/);
    expect(deploy).toMatch(/check_update \|\| go_back/);
    // Back to the safety copy only when the update changed the database.
    expect(deploy).toMatch(
      /if \[ -n "\$pending" \] && \[ -n "\$copy" \]; then[\s\S]*?restore_database/,
    );
    expect(lib).toMatch(/docker tag extras-erp-app:previous extras-erp-app:latest/);
  });

  it("closes the ERP to its users while a database-changing update is checked", () => {
    expect(deploy).toMatch(/compose stop caddy app/);
    expect(deploy).toMatch(/passed its check[\s\S]*?compose up -d caddy/);
  });
});
