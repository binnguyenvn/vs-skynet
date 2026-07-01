import type { ErrorClass, WorkerEvent, WorkerUsage } from "../types";

export interface InteractiveOpts {
  cwd: string;
  workerId: string;
  model?: string;
  configDir?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  turnTimeoutMs?: number;
  readyTimeoutMs?: number;
}

export type TurnResult =
  | { status: "paused"; summary: string }
  | { status: "done"; summary: string; usage?: WorkerUsage; filesTouched?: string[] }
  | { status: "error"; reason: string; errorClass?: ErrorClass }
  | { status: "timeout" }
  | { status: "crashed" };

export interface InteractiveSession extends AsyncIterable<WorkerEvent> {
  send(prompt: string): Promise<TurnResult>;
  readonly sessionId: Promise<string | undefined>;
  dispose(): Promise<void>;
}

export interface HarvestResult {
  sessionId?: string;
  usage?: WorkerUsage;
  rateLimits?: unknown;
}

export interface InteractiveCliProfile {
  id: "codex" | "claude" | "agy";
  launchArgv(opts: InteractiveOpts): string[];
  configEnv(configDir?: string): Record<string, string>;
  instructionFile: string;
  submitSequence: string;
  sessionDir(configDir?: string): string;
  harvest(sessionFileText: string): HarvestResult;
  sessionInfoPrompt?(outboxPath: string): string;
}

export interface TerminalTransport {
  show(preserveFocus: boolean): void;
  sendText(text: string, addNewLine: boolean): void;
  sendSequence(sequence: string): Promise<void>;
  processId(): Promise<number | undefined>;
  onDidClose(listener: (exitCode: number | undefined) => void): { dispose(): void };
  dispose(): void;
}

export interface TerminalFactory {
  create(opts: { name: string; cwd: string; env: Record<string, string> }): TerminalTransport;
}
