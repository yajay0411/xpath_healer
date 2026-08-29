/**
 * The durable healing workflow. The only export is the Inngest function itself: every gate
 * and decision is internal, and reachable for testing by its own path.
 *
 *   candidates/ what to try   - deterministic heuristics first, a model only if they come up empty
 *   gates/      what to allow - single-match proof, then diff policy
 *   sources/    what is true  - the repo at the failing commit, the locator, the captured DOM
 *   delivery/   what to do    - trigger Jenkins verification, open the PR
 */
export { healXpath } from "./workflow";
