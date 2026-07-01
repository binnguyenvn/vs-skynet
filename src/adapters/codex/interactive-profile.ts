import type { HarvestResult } from "../interactive/types";
import type { WorkerUsage } from "../types";

interface RolloutLine {
  type?: string;
  payload?: {
    id?: unknown;
    type?: string;
    info?: { total_token_usage?: Record<string, unknown> };
    rate_limits?: unknown;
  };
}

export function parseCodexRollout(text: string): HarvestResult {
  let sessionId: string | undefined;
  let usage: WorkerUsage | undefined;
  let rateLimits: unknown;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry: RolloutLine;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (entry.type === "session_meta" && entry.payload?.id) {
      sessionId = String(entry.payload.id);
    } else if (entry.type === "event_msg" && entry.payload?.type === "token_count") {
      const total = entry.payload.info?.total_token_usage;
      if (total) {
        usage = {
          inputTokens: Number(total.input_tokens ?? 0),
          outputTokens: Number(total.output_tokens ?? 0),
          cachedInputTokens: total.cached_input_tokens !== undefined ? Number(total.cached_input_tokens) : undefined,
          reasoningTokens:
            total.reasoning_output_tokens !== undefined ? Number(total.reasoning_output_tokens) : undefined,
        };
      }
      if (entry.payload.rate_limits) {
        rateLimits = entry.payload.rate_limits;
      }
    }
  }

  return { sessionId, usage, rateLimits };
}
