import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "./classify";
import { mapAgyLine, type AgyEvent, type AgyResult } from "./events";

export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: boolean;
  skipPermissions?: boolean;
}

/**
 * Async iterator is single-consumer: create one `for await` loop per run.
 * Concurrent iteration shares one internal event queue and is not supported.
 */
export interface AgyRun extends AsyncIterable<AgyEvent> {
  cancel(): void;
  result: Promise<AgyResult>;
}

export function runAgy(opts: RunOpts): AgyRun {
  const args = ["--print", opts.prompt];
  if (opts.skipPermissions ?? true) {
    args.push("--dangerously-skip-permissions");
  }
  if (opts.sandbox ?? true) {
    args.push("--sandbox");
  }
  if (opts.model) {
    args.push("--model", opts.model);
  }
  args.push("--add-dir", opts.cwd);

  const child = spawn("agy", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  let cancelled = false;
  const messages: string[] = [];

  const queue: AgyEvent[] = [];
  let resolveNext: ((r: IteratorResult<AgyEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: AgyEvent) => {
    if (ev.kind === "message") {
      messages.push(ev.text);
    }
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: ev, done: false });
    } else {
      queue.push(ev);
    }
  };

  const finishIter = () => {
    finished = true;
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as unknown as AgyEvent, done: true });
    }
  };

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    const ev = mapAgyLine(line);
    if (ev) {
      emit(ev);
    }
  });

  let settled = false;
  const result = new Promise<AgyResult>((resolve) => {
    const settle = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      finishIter();
      const lastMessage = messages.length ? messages.join("\n") : undefined;
      if (cancelled) {
        resolve({ status: "cancelled", reason: "cancelled by caller", lastMessage });
      } else if (exitCode === 0) {
        // ponytail: agy --print has no turn.completed marker; clean exit is success.
        resolve({ status: "success", lastMessage });
      } else {
        resolve({
          status: "failed",
          reason: stderr.trim() || `agy exited with code ${exitCode}`,
          errorClass: classifyError(stderr),
          lastMessage,
        });
      }
    };
    child.on("error", (err) => {
      stderr += String(err.message);
      settle(null);
    });
    child.on("close", (code) => settle(code));
  });

  const iterator: AsyncIterator<AgyEvent> = {
    next() {
      if (queue.length) {
        return Promise.resolve({ value: queue.shift()!, done: false });
      }
      if (finished) {
        return Promise.resolve({ value: undefined as unknown as AgyEvent, done: true });
      }
      return new Promise((r) => {
        resolveNext = r;
      });
    },
  };

  return {
    cancel() {
      cancelled = true;
      child.kill("SIGTERM");
    },
    result,
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}
