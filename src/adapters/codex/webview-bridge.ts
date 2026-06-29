import { runCodex, type CodexRun, type RunOpts } from "./codex-adapter";
import type { CodexEvent } from "./events";
import type { ExtensionToWebview } from "../../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

type CodexRunner = (opts: RunOpts) => CodexRun;

async function postLog(webview: LogWebview, level: "info" | "error", text: string): Promise<void> {
  await webview.postMessage({ type: "codexLog", level, text });
}

function formatEvent(ev: CodexEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started thread ${ev.threadId}`;
    case "message":
      return ev.text;
    case "usage":
      return `usage input=${ev.inputTokens} cached=${ev.cachedInputTokens} output=${ev.outputTokens} reasoning=${ev.reasoningOutputTokens}`;
    case "unknown":
      return null;
  }
}

export async function streamCodexTestToWebview(
  webview: LogWebview,
  cwd: string,
  runner: CodexRunner = runCodex
): Promise<void> {
  await postLog(webview, "info", "Starting Codex test...");

  const run = runner({
    prompt: "Reply with exactly the word: pong",
    cwd,
  });

  try {
    for await (const ev of run) {
      const text = formatEvent(ev);
      if (text) {
        await postLog(webview, "info", text);
      }
    }

    const result = await run.result;
    if (result.status === "success") {
      await postLog(webview, "info", "done success");
    } else {
      await postLog(webview, "error", `done ${result.status}: ${result.reason ?? "unknown error"}`);
    }
  } catch (err) {
    await postLog(webview, "error", err instanceof Error ? err.message : String(err));
  }
}
