import { runAgy, type AgyRun, type RunOpts } from "./agy-adapter";
import type { AgyEvent } from "./events";
import type { ExtensionToWebview } from "../../webview/protocol";

interface LogWebview {
  postMessage(msg: ExtensionToWebview): boolean | PromiseLike<boolean>;
}

type AgyRunner = (opts: RunOpts) => AgyRun;

async function postLog(webview: LogWebview, level: "info" | "error", text: string): Promise<void> {
  await webview.postMessage({ type: "agyLog", level, text });
}

function formatEvent(ev: AgyEvent): string | null {
  switch (ev.kind) {
    case "started":
      return `started thread ${ev.threadId}`;
    case "message":
      return ev.text;
    case "thought":
      return `thinking: ${ev.text}`;
    case "tool_call":
      return `tool ${ev.name}`;
    case "usage":
      return `usage input=${ev.inputTokens} output=${ev.outputTokens}`;
    case "unknown":
      return null;
  }
}

export async function streamAgyTestToWebview(
  webview: LogWebview,
  cwd: string,
  runner: AgyRunner = runAgy
): Promise<void> {
  await postLog(webview, "info", "Starting Antigravity test...");

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
