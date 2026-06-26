// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.
//
// NOTE: only `import type` from worker/* here, these files must not pull
// child_process into the webview bundle.
import type { Worker } from "../worker/types";
import type { WorkerEvent } from "../worker/adapters/types";

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "runTask"; worker: Worker; task: string }
  | { type: "cancelTask"; workerId: string };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "taskEvent"; workerId: string; event: WorkerEvent };
