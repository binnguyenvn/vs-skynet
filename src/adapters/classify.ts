import type { ErrorClass } from "./types";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: heuristic patterns inherited from the adapters, unverified against
// real limit/transport output. Refine the regexes on first real capture.
export function classifyError(text: string): ErrorClass {
  if (LIMIT.test(text)) {
    return "limit";
  }
  if (TRANSPORT.test(text)) {
    return "transport";
  }
  return "terminal";
}
