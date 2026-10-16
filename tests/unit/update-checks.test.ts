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
    const build = deploy.indexOf('if ! compose "${build[@]}"');
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

  it("keeps the images the running containers were made from, not whatever is named latest", () => {
    expect(lib).toMatch(/running_image app extras-erp-app:latest/);
    expect(lib).toMatch(/running_image migrate extras-erp-tools:latest/);
    expect(lib).toMatch(/docker inspect -f '\{\{\.Image\}\}'/);
    // A build that failed half way leaves the :latest names on the running version.
    expect(deploy).toMatch(
      /if ! compose "\$\{build\[@\]\}"; then\s+#[^\n]*\n\s+\[ "\$can_go_back" = 1 \] && use_previous_version\s+die "the new version could not be built/,
    );
  });

  it("makes room before building when the disk is nearly full", () => {
    const room = deploy.indexOf("Less than 5 GB is free");
    expect(room).toBeGreaterThan(0);
    expect(room).toBeLessThan(deploy.indexOf('if ! compose "${build[@]}"'));
    // Only unused steps and untagged images: the kept :previous version stays.
    expect(deploy).not.toMatch(/docker image prune -a/);
  });

  it("does not start an update without a safety copy of the database", () => {
    expect(lib).toMatch(/\[ ! -s "\$dir\/database.dump" \]; then\s+rm -rf "\$dir"\s+return 1/);
    expect(deploy).toMatch(
      /if ! saved="\$\(safety_copy "\$copy"\)"; then[\s\S]*?die "the safety copy/,
    );
    expect(deploy.indexOf('die "the safety copy')).toBeLessThan(
      deploy.indexOf("compose up -d --remove-orphans"),
    );
  });

  it("closes the ERP to its users while a database-changing update is checked", () => {
    expect(deploy).toMatch(/compose stop caddy app/);
    expect(deploy).toMatch(/passed its check[\s\S]*?compose up -d caddy/);
  });

  it("goes back to the earlier version, never the new build, when the safety copy fails", () => {
    // Starting the new build would run its database changes without a copy (v6.3 review).
    expect(deploy).toMatch(
      /if ! saved="\$\(safety_copy "\$copy"\)"; then[\s\S]*?\[ "\$can_go_back" = 1 \] && use_previous_version\s+\[ -n "\$pending" \] && \{ compose up -d --no-build app caddy \|\| true; \}\s+die "the safety copy/,
    );
    expect(deploy).not.toMatch(/\[ -n "\$pending" \] && compose up -d app caddy/);
  });

  it("does not update an ERP whose database is not running", () => {
    const refuse = deploy.indexOf(
      'if ! db_running && [ -s "$DATA_DIR/postgres/PG_VERSION" ]; then',
    );
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(deploy.indexOf("compose up -d --remove-orphans"));
    expect(deploy.slice(refuse, refuse + 400)).toMatch(
      /use_previous_version[\s\S]*?die "the database is not running/,
    );
  });

  it("starts the earlier version even when the database cannot be put back", () => {
    const back = deploy.slice(
      deploy.indexOf("go_back() {"),
      deploy.indexOf("\n}\n", deploy.indexOf("go_back() {")),
    );
    expect(back).toMatch(/if ! restore_database[\s\S]*?restored=0/);
    // No stop between the failed restore and starting the earlier version.
    expect(
      back.slice(back.indexOf("restored=0"), back.indexOf("use_previous_version")),
    ).not.toMatch(/die /);
    expect(back).toMatch(
      /use_previous_version\s+if compose up -d --no-build --remove-orphans && wait_healthy app/,
    );
    // Log lines on the way back never stop the script.
    expect(back).toMatch(/compose ps \|\| true/);
    expect(back).toMatch(/compose logs --tail 80 migrate app \|\| true/);
    expect(deploy).not.toMatch(/^\s*compose (ps|logs --tail 80 [a-z ]+)$/m);
  });

  it("clears every unused build step when space is short, then measures again", () => {
    expect(deploy).toMatch(/docker builder prune -a -f/);
    expect(deploy).toMatch(/Free space now/);
    expect(deploy).toMatch(/-lt \$\(\(3 \* 1024 \* 1024\)\)[\s\S]*?die "only/);
  });
});

describe("auto-deploy.sh", () => {
  const auto = readFileSync("deploy/auto-deploy.sh", "utf8");
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

  it("installs exactly the commit whose checks passed", () => {
    expect(workflow).toMatch(/printf '%s\\n' "\$GITHUB_SHA" \|\s+ssh /);
    expect(auto).toMatch(/IFS= read -r -t 10 wanted/);
    expect(auto).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(auto).toMatch(/merge-base --is-ancestor "\$wanted" origin\/main/);
    expect(auto).toMatch(/merge --quiet --ff-only "\$target"/);
    expect(auto).toMatch(/rev-parse HEAD\)" != "\$wanted"/);
  });
});
