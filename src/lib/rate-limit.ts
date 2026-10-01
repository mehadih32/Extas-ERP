import { AppError } from "@/lib/errors";

/**
 * Small in-memory fixed-window limiter. Good enough for the single-server VPS
 * deployment; swap for Redis if the app is ever scaled to several instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a minute and try again.");
  }
}

export function resetRateLimits(): void {
  buckets.clear();
}
