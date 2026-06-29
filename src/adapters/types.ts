export type ErrorClass = "limit" | "transport" | "terminal";

export type WorkerEvent =
  | { kind: "started"; sessionId: string; model?: string }
  | { kind: "message"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; name: string; input: unknown }
  | ({ kind: "usage" } & WorkerUsage)
  | { kind: "unknown"; raw: unknown };

export interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export interface WorkerResult {
  status: "success" | "failed" | "cancelled";
  reason?: string;
  errorClass?: ErrorClass;
  usage?: WorkerUsage;
  lastMessage?: string;
}

export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  configDir?: string;
  oauthToken?: string;
}

/**
 * Async iterator is single-consumer: create one `for await` loop per run.
 * Concurrent iteration shares one internal event queue and is not supported.
 */
export interface WorkerRun extends AsyncIterable<WorkerEvent> {
  cancel(): void;
  result: Promise<WorkerResult>;
}

export interface AgentAdapter {
  readonly id: "codex" | "claude" | "agy";
  run(opts: RunOpts): WorkerRun;
}
