import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { classifyError } from "../classify";
import { mapClaudeLine } from "./events";
import type { AgentAdapter, RunOpts, WorkerEvent, WorkerResult, WorkerRun, WorkerUsage } from "../types";

export interface ClaudeRunOpts extends RunOpts {
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  allowedTools?: string[];
}

export function runClaude(opts: ClaudeRunOpts): WorkerRun {
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  args.push("--permission-mode", opts.permissionMode ?? "default");
  if (opts.allowedTools?.length) {
    args.push("--allowedTools", ...opts.allowedTools);
  }
  args.push("--add-dir", opts.cwd);

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(opts.configDir ? { CLAUDE_CONFIG_DIR: opts.configDir } : {}),
      ...(opts.oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken } : {}),
    },
  });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  let cancelled = false;
  let usage: WorkerUsage | undefined;
  let lastMessage: string | undefined;
  let resultObj: any | undefined;

  const queue: WorkerEvent[] = [];
  let resolveNext: ((r: IteratorResult<WorkerEvent>) => void) | null = null;
  let finished = false;

  const emit = (ev: WorkerEvent) => {
    if (ev.kind === "usage") {
      usage = ev;
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
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (obj?.type === "result") {
      resultObj = obj;
    }
    for (const ev of mapClaudeLine(obj)) {
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
      const resultText = typeof resultObj?.result === "string" ? resultObj.result : "";
      const finalMessage = lastMessage ?? (resultText || undefined);
      if (cancelled) {
        resolve({ status: "cancelled", reason: "cancelled by caller", usage, lastMessage: finalMessage });
      } else if (exitCode === 0 && resultObj && resultObj.is_error === false) {
        // ponytail: success requires is_error===false, NOT subtype==='success'.
        resolve({ status: "success", usage, lastMessage: finalMessage });
      } else {
        resolve({
          status: "failed",
          reason: resultText || stderr.trim() || `claude exited with code ${exitCode}`,
          errorClass: classifyError(`${resultText}\n${stderr}`),
          usage,
          lastMessage: finalMessage,
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

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  run: (opts) => runClaude(opts),
};
