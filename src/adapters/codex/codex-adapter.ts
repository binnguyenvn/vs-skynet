import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "./classify";
import { mapCodexLine, type CodexEvent, type CodexResult, type CodexUsage } from "./events";

export interface RunOpts {
  prompt: string;
  cwd: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}

export interface CodexRun extends AsyncIterable<CodexEvent> {
  cancel(): void;
  result: Promise<CodexResult>;
}

export function runCodex(opts: RunOpts): CodexRun {
  const args = [
    "exec", "--json", "--skip-git-repo-check",
    "-s", opts.sandbox ?? "read-only",
    "-C", opts.cwd,
  ];
  if (opts.model) {
    args.push("-m", opts.model);
  }
  args.push(opts.prompt);

  // stdin 'ignore' is mandatory; an open/empty pipe makes codex block.
  const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  let cancelled = false;
  let usage: CodexUsage | undefined;
  let lastMessage: string | undefined;
  let sawTurn = false;

  // Bridge readline 'line' / process 'close' callbacks to an async iterator.
  const queue: CodexEvent[] = [];
  let resolveNext: ((r: IteratorResult<CodexEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: CodexEvent) => {
    if (ev.kind === "usage") {
      usage = ev;
      sawTurn = true;
    }
    if (ev.kind === "message") {
      lastMessage = ev.text;
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
      r({ value: undefined as unknown as CodexEvent, done: true });
    }
  };

  const rl = readline.createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    const ev = mapCodexLine(line);
    if (ev) {
      emit(ev);
    }
  });

  let settled = false;
  const result = new Promise<CodexResult>((resolve) => {
    const settle = (exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      rl.close();
      finishIter();
      if (cancelled) {
        resolve({ status: "cancelled", reason: "cancelled by caller", usage, lastMessage });
      } else if (exitCode === 0 && sawTurn) {
        resolve({ status: "success", usage, lastMessage });
      } else {
        resolve({
          status: "failed",
          reason: stderr.trim() || `codex exited with code ${exitCode}`,
          errorClass: classifyError(stderr),
          usage,
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

  const iterator: AsyncIterator<CodexEvent> = {
    next() {
      if (queue.length) {
        return Promise.resolve({ value: queue.shift()!, done: false });
      }
      if (finished) {
        return Promise.resolve({ value: undefined as unknown as CodexEvent, done: true });
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
