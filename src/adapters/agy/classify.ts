import type { ErrorClass } from "./events";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: duplicated with codex for now; extract when the next adapter needs it.
// ponytail: inherited heuristic, refine on first real agy limit/transport stderr.
export function classifyError(stderr: string): ErrorClass {
  if (LIMIT.test(stderr)) {
    return "limit";
  }
  if (TRANSPORT.test(stderr)) {
    return "transport";
  }
  return "terminal";
}
