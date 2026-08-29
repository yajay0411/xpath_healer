/**
 * Everything between "Jenkins posted a build result" and "a heal has been asked for".
 * Normalizes the payload, diagnoses whether it is XPath drift, and publishes one event per
 * broken locator. It never heals anything itself.
 */
export { normalize, diagnose, extractXpaths } from "./normalize";
export { publishFailures, publishVerify } from "./publish";
export type {
  NormalizedBuildFailure,
  TestFailure,
  Diagnosis,
} from "./types";
