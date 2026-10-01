import { z } from "zod";

/**
 * Boolean that also accepts query-string values. `z.coerce.boolean()` turns the
 * string "false" into `true`, so "?verified=false" would filter the wrong way.
 */
export const queryBoolean = z.union([
  z.boolean(),
  z
    .enum(["true", "false", "1", "0", "yes", "no"])
    .transform((v) => v === "true" || v === "1" || v === "yes"),
]);
