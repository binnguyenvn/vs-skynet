import type { ErrorClass } from "./events";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: heuristic stderr patterns from docs/reason, not from observed
// limit/transport output (a real 429 can't be induced on demand). Refine the
// regexes the first time we capture real limit/transport stderr.
export function classifyError(stderr: string): ErrorClass {
  if (LIMIT.test(stderr)) {
    return "limit";
  }
  if (TRANSPORT.test(stderr)) {
    return "transport";
  }
  return "terminal";
}
