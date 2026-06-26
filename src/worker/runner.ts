import { spawn } from "child_process";
import type { Worker } from "./types";
import { codexAdapter } from "./adapters/codex";
import type { AgentAdapter, Credentials, Invocation, WorkerEvent } from "./adapters/types";

export interface RunHandle {
  cancel(): void;
  done: Promise<void>;
}

export interface SpawnedProcess {
  stdout: AsyncIterable<Buffer>;
  kill(): void;
  exit: Promise<{ code: number | null; error?: Error }>;
}

export type SpawnFn = (inv: Invocation) => SpawnedProcess;

export interface RunDeps {
  spawnFn?: SpawnFn;
  adapter?: AgentAdapter;
  credentials?: Credentials;
}

export function runWorker(
  worker: Worker,
  task: string,
  onEvent: (e: WorkerEvent) => void,
  deps: RunDeps = {},
): RunHandle {
  const adapter = deps.adapter ?? codexAdapter;
  const spawnFn = deps.spawnFn ?? defaultSpawn;
  const creds = deps.credentials ?? {};
  const invocation = adapter.buildInvocation(worker, task, creds);

  let proc: SpawnedProcess;
  try {
    proc = spawnFn(invocation);
  } catch (err) {
    onEvent({ type: "error", message: errString(err), transport: isTransport(err) });
    return { cancel: () => {}, done: Promise.resolve() };
  }

  const done = (async () => {
    try {
      for await (const event of adapter.parseEvents(proc.stdout)) {
        onEvent(event);
      }
      const exit = await proc.exit;
      if (exit.error) {
        onEvent({ type: "error", message: errString(exit.error), transport: isTransport(exit.error) });
      } else if (exit.code !== null && exit.code !== 0) {
        onEvent({ type: "error", message: `codex exited with code ${exit.code}`, transport: false });
      }
    } catch (err) {
      onEvent({ type: "error", message: errString(err), transport: isTransport(err) });
    }
  })();

  return { cancel: () => proc.kill(), done };
}

function defaultSpawn(inv: Invocation): SpawnedProcess {
  // stdin "ignore" (=/dev/null) is required: an open stdin makes Codex block on
  // "Reading additional input from stdin...".
  const child = spawn(inv.command, inv.args, {
    cwd: inv.cwd,
    env: inv.env ? { ...process.env, ...inv.env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.on("error", (error) => resolve({ code: null, error }));
    child.on("close", (code) => resolve({ code }));
  });
  // ponytail: stderr is ignored in Epic 1; the verified failure signal is the exit
  // code. Capturing stderr lands with Observability (Epic 2).
  return {
    stdout: child.stdout!,
    kill: () => {
      child.kill();
    },
    exit,
  };
}

function isTransport(err: unknown): boolean {
  // ponytail: spawn/connection failures are fallback-eligible. Finer classification
  // (429/auth from codex stderr) lands with the AgentPool (Epic 6).
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "ETIMEDOUT";
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
