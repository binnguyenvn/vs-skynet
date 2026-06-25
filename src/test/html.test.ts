import * as assert from "assert";
import { buildWebviewHtml, nonce } from "../webview/html";

suite("buildWebviewHtml", () => {
  test("embeds nonce, uris, viewId and locks script-src to the nonce", () => {
    const html = buildWebviewHtml({
      scriptUri: "vscode-resource://main.js",
      styleUri: "vscode-resource://main.css",
      cspSource: "vscode-resource:",
      nonce: "ABC123",
      viewId: "hello",
    });
    assert.ok(html.includes("script-src 'nonce-ABC123'"), "script-src locked to nonce");
    assert.ok(html.includes('src="vscode-resource://main.js"'), "script uri present");
    assert.ok(html.includes('href="vscode-resource://main.css"'), "style uri present");
    assert.ok(html.includes('"viewId":"hello"'), "viewId injected as state");
    assert.ok(!html.includes("script-src 'unsafe-inline'"), "no inline scripts allowed");
  });

  test("nonce is 32 alphanumeric chars", () => {
    assert.match(nonce(), /^[A-Za-z0-9]{32}$/);
  });
});
