import { z } from "zod";

/**
 * Server-side environment variables, validated once at startup so a missing
 * or malformed value fails fast with a clear message instead of a runtime error.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string",
    }),
  AUTH_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  UPLOAD_DIR: z.string().default("./storage/uploads"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

// `next build` (e.g. inside the Docker image) runs without the runtime secrets,
// so validation happens when the server starts, not at build time.
const skipValidation =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.SKIP_ENV_VALIDATION === "1";

function loadEnv(): ServerEnv {
  if (skipValidation) {
    return process.env as unknown as ServerEnv;
  }
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
