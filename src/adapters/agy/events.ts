import type { WorkerEvent } from "../types";

// Map one agy stdout line to a WorkerEvent. Today agy prints plain markdown;
// structured JSONL branches are for the future SDK sidecar path.
export function mapAgyLine(line: string): WorkerEvent | null {
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
      return { kind: "started", sessionId: String(obj.thread_id ?? "") };
    case "tool_call":
      return { kind: "tool_call", name: String(obj.name ?? ""), input: obj.args };
    case "thought":
      return { kind: "thinking", text: String(obj.text ?? "") };
    case "usage":
      return { kind: "usage", inputTokens: obj.input_tokens ?? 0, outputTokens: obj.output_tokens ?? 0 };
    default:
      return { kind: "unknown", raw: obj };
  }
}
