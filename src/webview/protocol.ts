// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

// Per-CLI test knobs from the webview forms. All optional; bridges fall back to
// defaults. oauthToken is claude-only; workerId is interactive-only.
export interface TestFields {
  prompt?: string;
  model?: string;
  configDir?: string;
  oauthToken?: string;
  workerId?: string;
}

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string }
  | { type: "testCodex"; fields?: TestFields }
  | { type: "testAgy"; fields?: TestFields }
  | { type: "testClaude"; fields?: TestFields }
  | { type: "testCodexInteractiveStart"; fields?: TestFields }
  | { type: "testCodexInteractiveSend"; prompt: string }
  | { type: "testCodexInteractiveDispose" }
  | { type: "testAgyInteractiveStart"; fields?: TestFields }
  | { type: "testAgyInteractiveSend"; prompt: string }
  | { type: "testAgyInteractiveDispose" };

export type ExtensionToWebview =
  | { type: "greeting"; text: string }
  | { type: "codexLog"; level: "info" | "error"; text: string }
  | { type: "agyLog"; level: "info" | "error"; text: string }
  | { type: "claudeLog"; level: "info" | "error"; text: string }
  | { type: "codexInteractiveLog"; level: "info" | "error"; text: string }
  | { type: "agyInteractiveLog"; level: "info" | "error"; text: string };
