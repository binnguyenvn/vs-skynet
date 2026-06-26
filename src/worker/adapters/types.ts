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

export type WorkerEvent =
  | { type: "started" }
  | { type: "agent-message"; text: string }
  | { type: "tool-call"; name: string; detail?: string }
  | { type: "log"; level: "info" | "warn" | "error"; text: string }
  | { type: "decision-request"; questions: DecisionAsk[] }
  | { type: "done"; lastMessage?: string }
  | { type: "error"; message: string; transport?: boolean }; // transport=true -> fallback-eligible (Epic 6)

export interface AgentAdapter {
  readonly company: Company;
  readonly protocol: Protocol;
  allowedAuthMethods(): AuthMethod[];
  buildInvocation(worker: Worker, task: string, creds: Credentials): Invocation;
  parseEvents(raw: AsyncIterable<Buffer>): AsyncIterable<WorkerEvent>;
}
