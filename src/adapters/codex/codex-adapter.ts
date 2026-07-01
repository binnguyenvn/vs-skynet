import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "../classify";
import { startInteractive } from "../interactive/interactive-session";
import { mapCodexLine } from "./events";
import { codexInteractive } from "./interactive-profile";
import type { AgentAdapter, RunOpts, WorkerEvent, WorkerResult, WorkerRun, WorkerUsage } from "../types";

export interface CodexRunOpts extends RunOpts {
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}

export function runCodex(opts: CodexRunOpts): WorkerRun {
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
  const child = spawn("codex", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(opts.configDir ? { CODEX_HOME: opts.configDir } : {}) },
  });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  let cancelled = false;
  let usage: WorkerUsage | undefined;
  let lastMessage: string | undefined;
  let sawTurn = false;

  // Bridge readline 'line' / process 'close' callbacks to an async iterator.
  const queue: WorkerEvent[] = [];
  let resolveNext: ((r: IteratorResult<WorkerEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: WorkerEvent) => {
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
      r({ value: undefined as unknown as WorkerEvent, done: true });
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
  const result = new Promise<WorkerResult>((resolve) => {
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
        const incompleteSuccess = exitCode === 0 && !sawTurn;
        resolve({
          status: "failed",
          reason: incompleteSuccess
            ? "codex exited successfully without turn.completed"
            : stderr.trim() || `codex exited with code ${exitCode}`,
          errorClass: incompleteSuccess ? undefined : classifyError(stderr),
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

  const iterator: AsyncIterator<WorkerEvent> = {
    next() {
      if (queue.length) {
        return Promise.resolve({ value: queue.shift()!, done: false });
      }
      if (finished) {
        return Promise.resolve({ value: undefined as unknown as WorkerEvent, done: true });
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

export const codexAdapter: AgentAdapter = {
  id: "codex",
  run: (opts) => runCodex(opts),
  runInteractive: (opts) => startInteractive(codexInteractive, opts),
};
