import type { AuthMethod, Worker } from "../types";
import type { AgentAdapter, Credentials, Invocation, WorkerEvent } from "./types";

export const codexAdapter: AgentAdapter = {
  company: "openai",
  protocol: "cli",

  allowedAuthMethods(): AuthMethod[] {
    return ["oauth2Pkce", "apiKey"];
  },

  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation {
    const { agent, harness } = worker;
    const args = [
      "exec",
      "--json",
      "-s",
      harness.sandbox,
      "-C",
      harness.workingDir,
      "--skip-git-repo-check",
      "-c",
      "model_reasoning_summary=auto",
    ];
    for (const root of harness.writableRoots ?? []) {
      args.push("--add-dir", root);
    }
    if (agent.model) {
      args.push("-m", agent.model);
    }
    args.push(task);
    return { command: "codex", args, cwd: harness.workingDir, env: creds.env };
  },

  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
    return parseCodexEvents(raw);
  },
};

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  message?: string;
  changes?: { path?: string; kind?: string }[];
  [k: string]: unknown;
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
}

interface CodexEvent {
  type?: string;
  item?: CodexItem;
  message?: string;
  error?: { message?: string };
  usage?: unknown;
  [k: string]: unknown;
}

interface ParseState {
  started: boolean;
  lastMessage?: string;
}

const MAX_OUTPUT = 4000; // ponytail: cap tool/command output so one event can't be a megabyte

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…(truncated)" : s;
}

async function* parseCodexEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
  const state: ParseState = { started: false };
  let buffer = "";
  for await (const chunk of raw) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      yield* parseLine(buffer.slice(0, nl), state);
      buffer = buffer.slice(nl + 1);
    }
  }
  yield* parseLine(buffer, state);
}

function* parseLine(line: string, state: ParseState): Generator<WorkerEvent> {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let obj: CodexEvent;
  try {
    obj = JSON.parse(trimmed) as CodexEvent;
  } catch {
    return; // noise line (e.g. "Reading additional input from stdin...")
  }
  const mapped = mapCodexEvent(obj, state);
  if (Array.isArray(mapped)) {
    yield* mapped;
  } else if (mapped) {
    yield mapped;
  }
}

function mapCodexEvent(obj: CodexEvent, state: ParseState): WorkerEvent | WorkerEvent[] | null {
  switch (obj.type) {
    case "thread.started":
      if (state.started) {
        return null;
      }
      state.started = true;
      return { type: "started" };
    case "item.started": {
      const item = obj.item;
      if (item?.type === "command_execution") {
        return {
          type: "tool-call",
          id: item.id,
          name: "shell",
          detail: typeof item.command === "string" ? item.command : undefined,
        };
      }
      return null;
    }
    case "item.completed": {
      const item = obj.item;
      if (!item?.type) {
        return null;
      }
      if (item.type === "agent_message" && typeof item.text === "string") {
        state.lastMessage = item.text;
        return { type: "agent-message", text: item.text };
      }
      if (item.type === "reasoning" && typeof item.text === "string") {
        return { type: "reasoning", text: item.text };
      }
      if (item.type === "command_execution") {
        return {
          type: "tool-result",
          id: item.id,
          exitCode: item.exit_code,
          ok: item.exit_code === 0,
          output: typeof item.aggregated_output === "string" ? truncate(item.aggregated_output.trim()) : undefined,
        };
      }
      if (item.type === "file_change" && Array.isArray(item.changes)) {
        return item.changes
          .filter((c) => typeof c.path === "string")
          .map((c) => ({ type: "file-change" as const, path: c.path as string, kind: c.kind ?? "modify" }));
      }
      if (item.type === "error") {
        return { type: "error", message: item.message ?? "unknown codex error", transport: false };
      }
      // ponytail: still unmapped (e.g. mcp_tool_call, web_search) — surfaced as a log. Map when a
      // fixture proves their real shapes (Epic 4 touches MCP); the field names aren't verified yet.
      return { type: "log", level: "info", text: item.type };
    }
    case "turn.completed": {
      const usage = obj.usage as CodexUsage | undefined;
      const done: WorkerEvent = { type: "done", lastMessage: state.lastMessage };
      if (!usage || (usage.input_tokens === undefined && usage.cached_input_tokens === undefined && usage.output_tokens === undefined)) {
        return done;
      }
      return [
        {
          type: "usage",
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
        },
        done,
      ];
    }
    case "error":
    case "turn.failed":
      return { type: "error", message: errorMessage(obj), transport: false };
    default:
      return null; // turn.started and any other envelope we don't surface
  }
}

function errorMessage(obj: CodexEvent): string {
  return obj.error?.message ?? obj.message ?? "unknown codex error";
}
