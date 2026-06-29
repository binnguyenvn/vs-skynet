export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export type ErrorClass = "limit" | "transport" | "terminal";

export type CodexEvent =
  | { kind: "started"; threadId: string }
  | { kind: "message"; text: string }
  | ({ kind: "usage" } & CodexUsage)
  | { kind: "unknown"; raw: unknown };

export interface CodexResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: CodexUsage;
  lastMessage?: string;
}

// Map one codex `exec --json` JSONL line to a CodexEvent.
// Returns null for blank or non-JSON lines (e.g. the stdin notice).
export function mapCodexLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  switch (obj?.type) {
    case "thread.started":
      return { kind: "started", threadId: String(obj.thread_id ?? "") };
    case "item.completed":
      if (obj.item?.type === "agent_message") {
        return { kind: "message", text: String(obj.item.text ?? "") };
      }
      return { kind: "unknown", raw: obj };
    case "turn.completed": {
      const u = obj.usage ?? {};
      return {
        kind: "usage",
        inputTokens: u.input_tokens ?? 0,
        cachedInputTokens: u.cached_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        reasoningOutputTokens: u.reasoning_output_tokens ?? 0,
      };
    }
    default:
      return { kind: "unknown", raw: obj };
  }
}
