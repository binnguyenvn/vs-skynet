export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd?: number;
}

export type ErrorClass = "limit" | "transport" | "terminal";

export type ClaudeEvent =
  | { kind: "started"; sessionId: string; model: string }
  | { kind: "message"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; input: unknown }
  | ({ kind: "usage" } & ClaudeUsage)
  | { kind: "unknown"; raw: unknown };

export interface ClaudeResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: ClaudeUsage;
  lastMessage?: string;
}

function toUsage(u: any): ClaudeUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreationInputTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u?.cache_read_input_tokens ?? 0,
  };
}

export function mapClaudeLine(obj: any): ClaudeEvent[] {
  switch (obj?.type) {
    case "system":
      if (obj.subtype === "init") {
        return [{ kind: "started", sessionId: String(obj.session_id ?? ""), model: String(obj.model ?? "") }];
      }
      return [{ kind: "unknown", raw: obj }];
    case "assistant": {
      const out: ClaudeEvent[] = [];
      for (const b of obj.message?.content ?? []) {
        if (b?.type === "text") {
          out.push({ kind: "message", text: String(b.text ?? "") });
        } else if (b?.type === "thinking") {
          out.push({ kind: "thinking", text: String(b.thinking ?? b.text ?? "") });
        } else if (b?.type === "tool_use") {
          out.push({ kind: "tool_call", name: String(b.name ?? ""), input: b.input });
        } else {
          out.push({ kind: "unknown", raw: b });
        }
      }
      if (obj.message?.usage) {
        out.push({ kind: "usage", ...toUsage(obj.message.usage) });
      }
      return out;
    }
    case "result":
      return obj.usage ? [{ kind: "usage", ...toUsage(obj.usage), costUsd: obj.total_cost_usd }] : [];
    default:
      return [{ kind: "unknown", raw: obj }];
  }
}
