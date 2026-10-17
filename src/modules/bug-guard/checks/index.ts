import type { Check } from "../types";
import { AI_CHECKS } from "./ai";
import { APP_CHECKS } from "./app";
import { DATA_CHECKS } from "./data";
import { oldHelpPictures } from "./help-pictures";
import { PRODUCT_CHECKS } from "./product";
import { SECURITY_CHECKS } from "./security";

/** Every check Bug Guard runs, in the order of its report's areas. */
export const ALL_CHECKS: readonly Check[] = [
  ...APP_CHECKS,
  ...DATA_CHECKS,
  ...SECURITY_CHECKS,
  ...PRODUCT_CHECKS,
  oldHelpPictures,
  ...AI_CHECKS,
];
