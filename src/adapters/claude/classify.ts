import type { ErrorClass } from "./events";

const LIMIT = /rate.?limit|429|quota|too many requests/i;
const TRANSPORT = /network|econn|etimedout|timeout|socket|dns|enotfound/i;

// ponytail: classify.ts is now duplicated across codex + agy + claude. THREE
// consumers — extract a shared classifier in the "Error classification" US.
// ponytail: heuristic patterns are inherited from codex and unverified against
// real claude limit/transport output. Refine on first real capture.
export function classifyError(text: string): ErrorClass {
  if (LIMIT.test(text)) {
    return "limit";
  }
  if (TRANSPORT.test(text)) {
    return "transport";
  }
  return "terminal";
}
