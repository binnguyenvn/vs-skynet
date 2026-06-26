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
    ];
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
  [k: string]: unknown;
}

interface CodexEvent {
  type?: string;
  item?: CodexItem;
  message?: string;
  error?: { message?: string };
  [k: string]: unknown;
}

interface ParseState {
  started: boolean;
  lastMessage?: string;
}

async function* parseCodexEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent> {
  const state: ParseState = { started: false };
  let buffer = "";
  for await (const chunk of raw) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const event = parseLine(buffer.slice(0, nl), state);
      buffer = buffer.slice(nl + 1);
      if (event) {
        yield event;
      }
    }
  }
  const tail = parseLine(buffer, state);
  if (tail) {
    yield tail;
  }
}

function parseLine(line: string, state: ParseState): WorkerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let obj: CodexEvent;
  try {
    obj = JSON.parse(trimmed) as CodexEvent;
  } catch {
    return null; // noise line (e.g. "Reading additional input from stdin...")
  }
  return mapCodexEvent(obj, state);
}

function mapCodexEvent(obj: CodexEvent, state: ParseState): WorkerEvent | null {
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
          name: "shell",
          detail: typeof item.command === "string" ? item.command : undefined,
        };
      }
      return null;
    }
    case "item.completed": {
      const item = obj.item;
      if (item?.type === "agent_message" && typeof item.text === "string") {
        state.lastMessage = item.text;
        return { type: "agent-message", text: item.text };
      }
      if (item?.type === "command_execution") {
        return null; // already surfaced on item.started
      }
      if (item?.type) {
        // ponytail: unknown item types surfaced as a log; full observability is Epic 2.
        return { type: "log", level: "info", text: item.type };
      }
      return null;
    }
    case "turn.completed":
      return { type: "done", lastMessage: state.lastMessage };
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
