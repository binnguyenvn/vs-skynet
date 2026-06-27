import type { AuthMethod, Company, Protocol, Worker } from "../types";

// Resolved at run time, never serialized into Worker config. Epic 1: passthrough,
// Codex uses its own `codex login` (~/.codex/auth.json), so env is usually empty.
export interface Credentials {
  env?: Record<string, string>;
}

export interface Invocation {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface DecisionAsk {
  question: string;
  options?: { label: string; detail?: string }[];
  context?: string;
}

export type WorkerEvent = (
  | { type: "started" }
  | { type: "agent-message"; text: string }
  | { type: "reasoning"; text: string } // +
  | { type: "tool-call"; id?: string; name: string; detail?: string } // + id
  | { type: "tool-result"; id?: string; exitCode?: number; ok: boolean; output?: string } // +
  | { type: "file-change"; path: string; kind: string } // +
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } // +
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | { type: "verification"; command: string; ok: boolean; output?: string } // + (US-2)
  | { type: "decision-request"; questions: DecisionAsk[] }
  | { type: "done"; lastMessage?: string; verified?: boolean } // + verified (US-2)
  | { type: "error"; message: string; transport?: boolean; terminal?: boolean } // transport=true -> fallback-eligible (Epic 6); terminal=true -> the run is over (runner-generated, not a stream diagnostic)
) & { ts?: number }; // + every event optionally carries a runner-stamped emit timestamp

export interface AgentAdapter {
  readonly company: Company;
  readonly protocol: Protocol;
  allowedAuthMethods(): AuthMethod[];
  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation;
  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent>;
}
