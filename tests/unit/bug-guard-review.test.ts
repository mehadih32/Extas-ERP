import { describe, expect, it } from "vitest";

/*
 * v6.4 fresh review, Bug Guard and security (the parts that need no database):
 * the read-only guard refuses SQL that changes or locks something even inside
 * a SELECT (S13); a slow raw query is named so its issue can be sent (S11).
 */

import { makeTypedQueryFactory } from "@prisma/client/runtime/library";

import { guardOperation, readOnly, readsOnly } from "@/lib/read-only";
import { noteQueryTime, slowQueriesSince } from "@/lib/slow-queries";
import { guardIssue } from "@/modules/ai/full-check/texts";

describe("The read-only guard (S13)", () => {
  it("refuses a SELECT that ends sessions, takes locks, writes files or runs other SQL", () => {
    for (const sql of [
      "SELECT pg_terminate_backend(123)",
      "select pg_cancel_backend(pid) from pg_stat_activity",
      "SELECT pg_advisory_xact_lock(1)",
      "SELECT pg_try_advisory_lock(1)",
      "SELECT pg_advisory_lock_shared(1)",
      "SELECT pg_advisory_unlock_all()",
      "SELECT pg_reload_conf()",
      "SELECT pg_rotate_logfile()",
      "SELECT pg_switch_wal()",
      "SELECT pg_create_restore_point('x')",
      "SELECT pg_drop_replication_slot('x')",
      "SELECT pg_create_logical_replication_slot('x', 'pgoutput')",
      "SELECT pg_logical_emit_message(true, 'x', 'y')",
      "SELECT pg_promote()",
      "SELECT pg_stat_reset()",
      "SELECT pg_stat_reset_shared('bgwriter')",
      "SELECT pg_notify('x', 'y')",
      "SELECT lo_import('/etc/passwd')",
      "SELECT lo_unlink(16400)",
      "SELECT lo_from_bytea(0, '\\x00')",
      "SELECT pg_file_write('x', 'y', false)",
      "SELECT dblink_exec('dbname=x', 'DELETE FROM t')",
      "SELECT * FROM dblink('dbname=x', 'select 1') AS t(a int)",
      "SELECT query_to_xml('DELETE FROM \"Company\" RETURNING 1', true, true, '')",
      "SELECT cursor_to_xml('c', 1, true, true, '')",
      'SELECT id FROM "SupplierBill" WHERE id = $1 FOR SHARE',
      'SELECT id FROM "SupplierBill" WHERE id = $1 FOR NO KEY UPDATE',
      'SELECT id FROM "SupplierBill" WHERE id = $1 FOR KEY SHARE',
      "SELECT pg_import_system_collations('pg_catalog')",
    ]) {
      expect(readsOnly(sql), sql).toBe(false);
    }
  });

  it("still lets plain reads through", () => {
    for (const sql of [
      'SELECT 1 AS "n"',
      'SELECT COALESCE(SUM(l.debit), 0) AS d FROM "JournalLine" l WHERE l."entryId" = $1',
      'WITH x AS (SELECT id FROM "Company") SELECT COUNT(*)::int AS n FROM x',
      "SELECT pg_database_size(current_database())",
      "SELECT string_agg(name, ', ') FROM \"Party\"",
      // Words only inside quotes are not commands.
      "SELECT 'pg_terminate_backend' AS word",
      'SELECT "lockedUntil" FROM "User"',
    ]) {
      expect(readsOnly(sql), sql).toBe(true);
    }
  });
});

describe("A typed raw query (S13)", () => {
  it("is judged by its SQL in read-only work, like the other raw queries", async () => {
    const typed = (sql: string) => makeTypedQueryFactory(sql)();
    await readOnly("Bug Guard only reads while it checks", async () => {
      await guardOperation("$queryRawTyped", typed('SELECT 1 AS "n"'));
      await expect(
        guardOperation("$queryRawTyped", typed(`UPDATE "Company" SET "name" = 'x'`)),
      ).rejects.toThrow(/only reads/);
      await expect(
        guardOperation("$queryRawTyped", typed("SELECT pg_terminate_backend(1)")),
      ).rejects.toThrow(/only reads/);
    });
  });
});

describe("Slow raw queries (S11)", () => {
  it("are named so Bug Guard's issue can carry them", () => {
    const since = new Date(Date.now() - 1000);
    noteQueryTime(undefined, "$queryRaw", 1500);
    const slow = slowQueriesSince(since).find((q) => q.operation === "$queryRaw")!;
    expect(slow.model).toMatch(/^[A-Za-z]+$/);
    const issue = guardIssue({
      facts: {
        route: `database: ${slow.model}.${slow.operation}`,
        errorType: "SlowQuery",
        times: 1,
      },
      site: "live",
      at: "2026-10-16 10:00",
      issue: 12,
    });
    expect(issue.title).toBe(`Bug Guard: slow database call ${slow.model}.$queryRaw`);
    expect(issue.body).not.toContain("(a screen)");
  });
});
