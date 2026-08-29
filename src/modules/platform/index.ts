/**
 * Infrastructure every other module leans on: the database, blob storage, and the event bus.
 * Knows nothing about XPath, Jenkins or healing.
 */
export { db } from "./supabase";
export { getDom, putDom } from "./storage";
export {
  inngest,
  xpathFailureDetected,
  jenkinsVerifyCompleted,
  xpathHealCompleted,
  HEAL_STATUSES,
  type HealStatus,
} from "./events";
