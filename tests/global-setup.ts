import { execSync } from "node:child_process";

/** Applies any pending migrations to the throwaway test database before the suite runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'.");
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
