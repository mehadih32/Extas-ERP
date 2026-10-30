import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * A restore puts the whole database back in one transaction (deploy/lib.sh:
 * restore_database). With the 2026-10 retail tables, dropping and making every
 * table, index and key took about 3,900 locks, more than the 3,200 a database
 * with 50 connections and the default 64 per connection has, so the restore drill
 * stopped with "out of shared memory" (review 2026-10-30).
 */
describe("the database has room for a restore's locks", () => {
  const compose = readFileSync(path.join("deploy", "compose.yml"), "utf8");

  it("raises max_locks_per_transaction on the ERP's and the demo site's database", () => {
    const raised = compose.match(/- max_locks_per_transaction=(\d+)/g) ?? [];
    expect(raised).toHaveLength(2);
    for (const line of raised) expect(Number(line.split("=")[1])).toBeGreaterThanOrEqual(256);
    expect(readFileSync(path.join("deploy", "lib.sh"), "utf8")).toContain(
      "BEGIN; DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
    );
  });
});
