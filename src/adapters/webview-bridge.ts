import type { AgentAdapter, RunOpts, WorkerEvent } from "./types";
import type { InteractiveOpts, InteractiveSession, TurnResult } from "./interactive/types";
import type { ExtensionToWebview } from "../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

const LABELS: Record<AgentAdapter["id"], string> = { codex: "Codex", claude: "Claude", agy: "Agy" };

export function formatEvent(ev: WorkerEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started session ${ev.sessionId}${ev.model ? ` (${ev.model})` : ""}`;
    case "message":
      return ev.text;
    case "thinking":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage": {
      let s = `usage in=${ev.inputTokens} out=${ev.outputTokens}`;
      if (ev.cachedInputTokens !== undefined) {
        s += ` cached=${ev.cachedInputTokens}`;
      }
      if (ev.cacheWriteTokens !== undefined) {
        s += ` cacheW=${ev.cacheWriteTokens}`;
      }
      if (ev.reasoningTokens !== undefined) {
        s += ` reasoning=${ev.reasoningTokens}`;
      }
      if (ev.costUsd !== undefined) {
        s += ` cost=$${ev.costUsd}`;
      }
      return s;
    }
    case "unknown":
      return null;
  }
}

export async function startInteractiveTestToWebview(
  adapter: AgentAdapter,
  webview: LogWebview,
  opts: InteractiveOpts
): Promise<InteractiveSession | undefined> {
  const post = (level: "info" | "error", text: string) =>
    webview.postMessage({ type: "codexInteractiveLog", level, text });

  if (!adapter.runInteractive) {
    await post("error", `${adapter.id} does not support interactive mode`);
    return undefined;
  }

  await post("info", `Starting ${LABELS[adapter.id]} interactive session...`);
  try {
    const session = await adapter.runInteractive(opts);
    void (async () => {
      try {
        for await (const ev of session) {
          const text = formatEvent(ev);
          if (text) {
            await post("info", text);
          }
        }
      } catch (err) {
        await post("error", err instanceof Error ? err.message : String(err));
      }
    })();
    return session;
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

export async function sendInteractiveTurn(
  session: InteractiveSession | undefined,
  webview: LogWebview,
  prompt: string
): Promise<void> {
  const post = (level: "info" | "error", text: string) =>
    webview.postMessage({ type: "codexInteractiveLog", level, text });

  if (!session) {
    await post("error", "no interactive session running - click Start Interactive first");
    return;
  }

  try {
    const result = await session.send(prompt);
    const level = result.status === "paused" || result.status === "done" ? "info" : "error";
    await post(level, formatTurnResult(result));
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
  }
}

function formatTurnResult(result: TurnResult): string {
  switch (result.status) {
    case "paused":
      return `paused: ${result.summary}`;
    case "done":
      return `done: ${result.summary}`;
    case "error":
      return `error: ${result.reason}`;
    case "timeout":
      return "timeout";
    case "crashed":
      return "crashed";
  }
}

export async function streamAdapterTestToWebview(
  adapter: AgentAdapter,
  webview: LogWebview,
  cwd: string,
  overrides: Partial<RunOpts> = {}
): Promise<void> {
  const logType = `${adapter.id}Log` as "codexLog" | "claudeLog" | "agyLog";
  const post = (level: "info" | "error", text: string) =>
    webview.postMessage({ type: logType, level, text });

  await post("info", `Starting ${LABELS[adapter.id]} test...`);

  const run = adapter.run({ prompt: "Reply with exactly the word: pong", cwd, ...overrides });

  try {
    for await (const ev of run) {
      const text = formatEvent(ev);
      if (text) {
        await post("info", text);
      }
    }

    const result = await run.result;
    if (result.status === "success") {
      await post("info", "done success");
    } else {
      await post("error", `done ${result.status}: ${result.reason ?? "unknown error"}`);
    }
  } catch (err) {
    await post("error", err instanceof Error ? err.message : String(err));
  }
}
