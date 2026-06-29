// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "testCodex" }
  | { type: "testAgy" }
  | { type: "testClaude" };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "codexLog"; level: "info" | "error"; text: string }
  | { type: "agyLog"; level: "info" | "error"; text: string }
  | { type: "claudeLog"; level: "info" | "error"; text: string };
