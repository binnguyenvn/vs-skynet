export interface AgyUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ErrorClass = "limit" | "transport" | "terminal";

export type AgyEvent =
  | { kind: "started"; threadId: string }
  | { kind: "message"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "tool_call"; name: string; args: unknown }
  | ({ kind: "usage" } & AgyUsage)
  | { kind: "unknown"; raw: unknown };

export interface AgyResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: AgyUsage;
  lastMessage?: string;
}

// Map one agy stdout line to an AgyEvent. Today agy prints plain markdown;
// structured JSONL branches are for the future SDK sidecar path.
export function mapAgyLine(line: string): AgyEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "message", text: trimmed };
  }

  // ponytail: dormant until agy or a sidecar emits JSONL; keeps the parser swap tiny.
  switch (obj?.type) {
    case "thread.started":
      return { kind: "started", threadId: String(obj.thread_id ?? "") };
    case "tool_call":
      return { kind: "tool_call", name: String(obj.name ?? ""), args: obj.args };
    case "thought":
      return { kind: "thought", text: String(obj.text ?? "") };
    case "usage":
      return { kind: "usage", inputTokens: obj.input_tokens ?? 0, outputTokens: obj.output_tokens ?? 0 };
    default:
      return { kind: "unknown", raw: obj };
  }
}
