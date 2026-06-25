// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string };

export type ExtensionToWebview =
  | { type: "greeting"; text: string };
