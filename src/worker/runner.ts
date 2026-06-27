import { spawn, exec } from "child_process";
import type { Worker } from "./types";
import { codexAdapter } from "./adapters/codex";
import type { AgentAdapter, Credentials, Invocation, WorkerEvent } from "./adapters/types";

export interface RunHandle {
  cancel(): void;
  done: Promise<void>;
}

export interface SpawnedProcess {
  stdout: AsyncIterable<Buffer>;
  stderr?: AsyncIterable<Buffer>;
  kill(): void;
  exit: Promise<{ code: number | null; error?: Error }>;
}

export type SpawnFn = (inv: Invocation) => SpawnedProcess;

export type VerifyFn = (command: string, cwd: string) => Promise<{ ok: boolean; output?: string }>;

export interface RunDeps {
  spawnFn?: SpawnFn;
  adapter?: AgentAdapter;
  credentials?: Credentials;
  now?: () => number;
  verifyFn?: VerifyFn;
}

const VERIFY_TIMEOUT_MS = 120_000;

function defaultVerify(command: string, cwd: string): Promise<{ ok: boolean; output?: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      resolve({ ok: !err, output: output || undefined });
    });
  });
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

  const now = deps.now ?? Date.now;
  const emit = (e: WorkerEvent) => onEvent({ ...e, ts: now() });

  let proc: SpawnedProcess;
  try {
    proc = spawnFn(invocation);
  } catch (err) {
    emit({ type: "error", message: errString(err), transport: isTransport(err), terminal: true });
    return { cancel: () => {}, done: Promise.resolve() };
  }

  const verifyFn = deps.verifyFn ?? defaultVerify;
  let pendingDone: Extract<WorkerEvent, { type: "done" }> | null = null;

  const done = (async () => {
    const harness = worker.harness;
    let toolCalls = 0;
    let stopReason: "steps" | "timeout" | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // ponytail: abortSignal lets the timer interrupt a blocking iter.next()
    // (e.g. hang() in the timeout test) without racing proc.exit against events.
    // Steps cap triggers abortResolve inline; timeout timer triggers it from closure.
    let abortResolve!: () => void;
    const abortSignal = new Promise<void>((r) => { abortResolve = r; });
    const ABORTED = Symbol("aborted");

    if (harness.timeoutMs && harness.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (stopReason === null) {
          stopReason = "timeout";
          proc.kill();
          abortResolve();
        }
      }, harness.timeoutMs);
    }

    const stderrDone = drainStderr(proc.stderr, emit);
    try {
      const iter = adapter.parseEvents(proc.stdout)[Symbol.asyncIterator]();
      while (true) {
        if (stopReason !== null) { break; }
        const raced = await Promise.race([
          iter.next(),
          abortSignal.then(() => ABORTED),
        ]);
        if (raced === ABORTED) { break; }
        const result = raced as IteratorResult<WorkerEvent>;
        if (result.done) { break; }
        const event = result.value;
        if (event.type === "tool-call") {
          toolCalls++;
          if (harness.maxSteps !== undefined && toolCalls > harness.maxSteps) {
            stopReason = "steps";
            emit(event);
            proc.kill();
            break;
          }
        }
        if (event.type === "done") {
          pendingDone = event;
          continue;
        }
        emit(event);
      }
      // Disarm the timer synchronously before any await so it cannot fire
      // during the proc.exit window and wrongly set stopReason = "timeout".
      if (timer) { clearTimeout(timer); timer = undefined; }
      const exit = await proc.exit;
      if (stopReason === "steps") {
        emit({ type: "error", message: `step cap (${harness.maxSteps}) exceeded`, transport: false, terminal: true });
      } else if (stopReason === "timeout") {
        emit({ type: "error", message: `timeout (${harness.timeoutMs}ms) exceeded`, transport: false, terminal: true });
      } else if (exit.error) {
        emit({ type: "error", message: errString(exit.error), transport: isTransport(exit.error), terminal: true });
      } else if (exit.code !== null && exit.code !== 0) {
        emit({ type: "error", message: `${invocation.command} exited with code ${exit.code}`, transport: false, terminal: true });
      } else if (pendingDone) {
        const checks = harness.verification ?? [];
        if (checks.length === 0) {
          emit(pendingDone);
        } else {
          let verified = true;
          for (const check of checks) {
            const r = await verifyFn(check.command, harness.workingDir);
            emit({ type: "verification", command: check.command, ok: r.ok, output: r.output });
            if (!r.ok) {
              verified = false;
            }
          }
          emit({ ...pendingDone, verified });
        }
      }
    } catch (err) {
      emit({ type: "error", message: errString(err), transport: isTransport(err), terminal: true });
    } finally {
      if (timer) { clearTimeout(timer); }
      await stderrDone;
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
  return {
    stdout: child.stdout!,
    stderr: child.stderr ?? undefined,
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

async function drainStderr(
  stderr: AsyncIterable<Buffer> | undefined,
  emit: (e: WorkerEvent) => void,
): Promise<void> {
  if (!stderr) {
    return;
  }
  let buffer = "";
  for await (const chunk of stderr) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      emitStderrLine(buffer.slice(0, nl), emit);
      buffer = buffer.slice(nl + 1);
    }
  }
  emitStderrLine(buffer, emit);
}

function emitStderrLine(line: string, emit: (e: WorkerEvent) => void): void {
  const text = line.trim();
  // ponytail: this notice is benign (stdin is /dev/null) and just noise — drop it.
  if (!text || text.startsWith("Reading additional input from stdin")) {
    return;
  }
  emit({ type: "log", level: "error", text });
}
