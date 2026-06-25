# React Webview Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a unified React + Tailwind v4 + shadcn foundation for the extension's many webviews, with styling that tracks the active VSCode theme automatically.

**Architecture:** Reuse the existing esbuild build by adding a second browser-target context for a single shared webview bundle; each panel is opened with a `viewId` and the React app renders the matching view. Tailwind v4 compiles via its CLI; shadcn tokens are remapped to VSCode CSS variables so panels follow light/dark/high-contrast.

**Tech Stack:** TypeScript, esbuild, React 19, Tailwind CSS v4 (`@tailwindcss/cli`), shadcn-style components (class-variance-authority, clsx, tailwind-merge, @radix-ui/react-slot), VSCode Webview API.

## Global Constraints

- VSCode engine: `^1.125.0` (already set).
- Extension build target unchanged: `src/extension.ts` → `dist/extension.js` (node/cjs).
- Webview bundle is browser/IIFE → `dist/webview/main.js`; styles → `dist/webview/main.css`.
- No Vite. Webview builds through a second esbuild context + Tailwind CLI.
- No path aliases (`@/...`) — use relative imports (avoids esbuild/tsconfig alias config).
- One shared webview bundle with an internal `switch` on `viewId`; no routing library.
- shadcn theme tokens map to `var(--vscode-*)`; dark/light driven by the `vscode-*` body class VSCode sets — no separate theme toggle.

---

### Task 1: Webview build pipeline & theme glue

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `esbuild.js` (second build context)
- Modify: `tsconfig.json` (jsx + DOM lib)
- Create: `src/webview/index.tsx` (stub, replaced in Task 4)
- Create: `src/webview/styles.css` (Tailwind + VSCode var mapping)

**Interfaces:**
- Produces: `dist/webview/main.js` (IIFE bundle of `src/webview/index.tsx`), `dist/webview/main.css` (compiled Tailwind). Later tasks load these two files.

- [ ] **Step 1: Install dependencies**

```bash
npm i react react-dom class-variance-authority clsx tailwind-merge @radix-ui/react-slot
npm i -D @types/react @types/react-dom tailwindcss @tailwindcss/cli
```

- [ ] **Step 2: Add DOM lib + JSX to `tsconfig.json`**

Change `compilerOptions.lib` and add `jsx`:

```json
        "lib": [
            "ES2022",
            "DOM",
            "DOM.Iterable"
        ],
        "jsx": "react-jsx",
```

(Place `"jsx": "react-jsx",` alongside the other compilerOptions, e.g. after `"target"`.)

- [ ] **Step 3: Add the second esbuild context in `esbuild.js`**

Inside `main()`, after the existing extension `ctx` is created, add a webview context and handle both. Replace the `if (watch) { ... } else { ... }` block so it drives both contexts:

```js
	const webviewCtx = await esbuild.context({
		entryPoints: ['src/webview/index.tsx'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview/main.js',
		jsx: 'automatic',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	if (watch) {
		await Promise.all([ctx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([ctx.rebuild(), webviewCtx.rebuild()]);
		await Promise.all([ctx.dispose(), webviewCtx.dispose()]);
	}
```

- [ ] **Step 4: Add Tailwind + webview scripts in `package.json`**

Add to `scripts` (keep existing entries):

```json
    "build:css": "tailwindcss -i ./src/webview/styles.css -o ./dist/webview/main.css",
    "watch:css": "tailwindcss -i ./src/webview/styles.css -o ./dist/webview/main.css --watch",
```

Update `compile` and `package` to also build CSS:

```json
    "compile": "npm run check-types && npm run lint && node esbuild.js && npm run build:css",
    "package": "npm run check-types && npm run lint && node esbuild.js --production && npm run build:css",
```

(`watch` stays `npm-run-all -p watch:*`; it now also runs `watch:css`.)

- [ ] **Step 5: Create `src/webview/styles.css` (the theme glue)**

```css
@import "tailwindcss";
@source "./**/*.tsx";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-muted: var(--muted);
  --color-destructive: var(--destructive);
  --radius: var(--radius-base);
}

:root {
  --background: var(--vscode-editor-background);
  --foreground: var(--vscode-foreground);
  --primary: var(--vscode-button-background);
  --primary-foreground: var(--vscode-button-foreground);
  --border: var(--vscode-panel-border);
  --input: var(--vscode-input-background);
  --ring: var(--vscode-focusBorder);
  --muted: var(--vscode-editorWidget-background);
  --destructive: var(--vscode-errorForeground);
  --radius-base: 4px;
}

body {
  margin: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--foreground);
  background: var(--background);
}
```

- [ ] **Step 6: Create stub `src/webview/index.tsx`**

```tsx
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <div className="p-4 text-foreground">Skynet webview boot OK</div>
);
```

- [ ] **Step 7: Build and verify outputs exist**

Run: `npm run compile`
Expected: command succeeds; both files exist:

```bash
ls dist/webview/main.js dist/webview/main.css
```

Expected: both paths listed, no error.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json esbuild.js tsconfig.json src/webview/index.tsx src/webview/styles.css
git commit -m "feat: add webview build pipeline (esbuild + tailwind v4) and theme glue"
```

---

### Task 2: Shared message types + CSP HTML builder

**Files:**
- Create: `src/webview/protocol.ts`
- Create: `src/webview/html.ts`
- Create: `src/test/html.test.ts`

**Interfaces:**
- Produces:
  - `WebviewToExtension = { type: "ready" } | { type: "hello"; name: string }`
  - `ExtensionToWebview = { type: "greeting"; text: string }`
  - `nonce(): string` — 32-char alphanumeric.
  - `buildWebviewHtml(opts: { scriptUri: string; styleUri: string; cspSource: string; nonce: string; viewId: string }): string`
- Consumes: nothing (no vscode import — pure, unit-testable).

- [ ] **Step 1: Write the failing test `src/test/html.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile-tests && npx vscode-test --label html 2>/dev/null || npm test`
Expected: FAIL — cannot find module `../webview/html`.

- [ ] **Step 3: Create `src/webview/html.ts`**

```ts
export function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export function buildWebviewHtml(opts: {
  scriptUri: string;
  styleUri: string;
  cspSource: string;
  nonce: string;
  viewId: string;
}): string {
  const { scriptUri, styleUri, cspSource, nonce, viewId } = opts;
  const state = JSON.stringify({ viewId });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};" />
  <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__INITIAL_STATE__ = ${state};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Create `src/webview/protocol.ts`**

```ts
// Messages shared by the extension host and the webview. Imported by both
// sides so the postMessage contract is checked at compile time.

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "hello"; name: string };

export type ExtensionToWebview =
  | { type: "greeting"; text: string };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — both `buildWebviewHtml` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/webview/html.ts src/webview/protocol.ts src/test/html.test.ts
git commit -m "feat: add webview message protocol and CSP html builder"
```

---

### Task 3: Extension webview helper + command

**Files:**
- Create: `src/webview/panel.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (contributes.commands)

**Interfaces:**
- Consumes: `buildWebviewHtml`, `nonce` from `./html`; `WebviewToExtension` from `./protocol`.
- Produces: `openWebview(context: vscode.ExtensionContext, viewId: string): vscode.WebviewPanel` — creates a themed panel, wires the message round-trip.

- [ ] **Step 1: Create `src/webview/panel.ts`**

```ts
import * as vscode from "vscode";
import { buildWebviewHtml, nonce } from "./html";
import type { WebviewToExtension } from "./protocol";

export function openWebview(
  context: vscode.ExtensionContext,
  viewId: string
): vscode.WebviewPanel {
  const distWebview = vscode.Uri.joinPath(context.extensionUri, "dist", "webview");
  const panel = vscode.window.createWebviewPanel(
    "skynet." + viewId,
    "Skynet",
    vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [distWebview] }
  );

  const webview = panel.webview;
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(distWebview, "main.js"))
    .toString();
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(distWebview, "main.css"))
    .toString();

  webview.html = buildWebviewHtml({
    scriptUri,
    styleUri,
    cspSource: webview.cspSource,
    nonce: nonce(),
    viewId,
  });

  webview.onDidReceiveMessage(
    (msg: WebviewToExtension) => {
      if (msg.type === "hello") {
        vscode.window.showInformationMessage(`Webview says hello: ${msg.name}`);
        webview.postMessage({ type: "greeting", text: `Hello back, ${msg.name}!` });
      }
    },
    undefined,
    context.subscriptions
  );

  return panel;
}
```

- [ ] **Step 2: Register the command in `src/extension.ts`**

Add the import at the top (after the `vscode` import):

```ts
import { openWebview } from "./webview/panel";
```

Inside `activate()`, before `context.subscriptions.push(disposable);`, add:

```ts
	const openPanel = vscode.commands.registerCommand("skynet-harness.openWebview", () => {
		openWebview(context, "hello");
	});
	context.subscriptions.push(openPanel);
```

- [ ] **Step 3: Add the command to `package.json`**

In `contributes.commands`, add a second entry:

```json
      {
        "command": "skynet-harness.openWebview",
        "title": "Skynet: Open Webview"
      }
```

- [ ] **Step 4: Build and type-check**

Run: `npm run compile`
Expected: succeeds, no type errors.

- [ ] **Step 5: Manual smoke check**

Press `F5` to launch the Extension Development Host. Run command **"Skynet: Open Webview"** from the Command Palette.
Expected: a panel titled "Skynet" opens showing "Skynet webview boot OK" (the Task 1 stub), styled with the editor's background/foreground colors.

- [ ] **Step 6: Commit**

```bash
git add src/webview/panel.ts src/extension.ts package.json
git commit -m "feat: add openWebview helper and Open Webview command"
```

---

### Task 4: Webview React UI + message round-trip

**Files:**
- Create: `src/webview/lib/vscode.ts`
- Create: `src/webview/lib/utils.ts`
- Create: `src/webview/components/ui/button.tsx`
- Create: `src/webview/views/hello.tsx`
- Modify: `src/webview/index.tsx` (replace stub with the view router)

**Interfaces:**
- Consumes: `WebviewToExtension`, `ExtensionToWebview` from `../protocol`; `openWebview` round-trip from Task 3.
- Produces: the `hello` view rendering a shadcn `Button` that posts `{ type: "hello", name: "Skynet" }` and displays the `{ type: "greeting" }` reply.

- [ ] **Step 1: Create `src/webview/lib/vscode.ts` (typed message bus)**

```ts
import type { ExtensionToWebview, WebviewToExtension } from "../protocol";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postMessage(msg: WebviewToExtension): void {
  vscode.postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionToWebview) => void): () => void {
  const listener = (e: MessageEvent) => handler(e.data as ExtensionToWebview);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
```

- [ ] **Step 2: Create `src/webview/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Create `src/webview/components/ui/button.tsx`**

```tsx
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-[var(--radius)] text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 px-4 py-2",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        destructive: "bg-destructive text-white hover:opacity-90",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, className }))} {...props} />;
}
```

- [ ] **Step 4: Create `src/webview/views/hello.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { onMessage, postMessage } from "../lib/vscode";

export function HelloView() {
  const [reply, setReply] = useState("");

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "greeting") {
          setReply(msg.text);
        }
      }),
    []
  );

  return (
    <div className="p-4 flex flex-col gap-3 items-start">
      <h1 className="text-lg font-semibold">Skynet Webview</h1>
      <Button onClick={() => postMessage({ type: "hello", name: "Skynet" })}>
        Say hello to the extension
      </Button>
      {reply && <p>{reply}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Replace `src/webview/index.tsx` with the view router**

```tsx
import { createRoot } from "react-dom/client";
import { HelloView } from "./views/hello";

declare global {
  interface Window {
    __INITIAL_STATE__: { viewId: string };
  }
}

function App({ viewId }: { viewId: string }) {
  switch (viewId) {
    case "hello":
      return <HelloView />;
    default:
      return <div className="p-4">Unknown view: {viewId}</div>;
  }
}

const { viewId } = window.__INITIAL_STATE__;
createRoot(document.getElementById("root")!).render(<App viewId={viewId} />);
```

- [ ] **Step 6: Build and type-check**

Run: `npm run compile`
Expected: succeeds, no type errors, `dist/webview/main.js` + `main.css` regenerated.

- [ ] **Step 7: Manual round-trip verification**

Press `F5`. Run **"Skynet: Open Webview"**.
Expected:
1. Panel shows "Skynet Webview" heading and a button styled with the editor's button colors.
2. Clicking the button → an information toast "Webview says hello: Skynet" appears.
3. The text "Hello back, Skynet!" appears under the button.
4. Switch VSCode theme (light ↔ dark) and reopen the panel → colors follow the theme.

- [ ] **Step 8: Commit**

```bash
git add src/webview/lib src/webview/components src/webview/views src/webview/index.tsx
git commit -m "feat: add shadcn button, typed message bus, and hello round-trip view"
```

---

## Self-Review

**Spec coverage:**
- Second esbuild context → Task 1. ✓
- Tailwind v4 via CLI → Task 1 (scripts). ✓
- One shared bundle + viewId switch → Task 4 (`index.tsx`). ✓
- `openWebview` helper with CSP + nonce + asWebviewUri + injected state → Tasks 2 (html) + 3 (panel). ✓
- Typed message bus `lib/vscode.ts` → Task 4. ✓
- Theme mapping CSS + body class theming → Task 1 (`styles.css`). ✓
- shadcn Button sample → Task 4. ✓
- `hello` demo view round-trip → Tasks 3 + 4. ✓
- Shared `protocol.ts` imported by both sides → Task 2 (created), consumed in 3 & 4. ✓
- Demo command `skynet-harness.openWebview`, keep `helloWorld` → Task 3. ✓
- Test on message/HTML shape → Task 2 (`html.test.ts`). ✓
- Out of scope (routing/state libs, extra components, Vite) → not added. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete.

**Type consistency:** `WebviewToExtension`/`ExtensionToWebview` defined in Task 2 and used identically in `panel.ts` (Task 3) and `lib/vscode.ts` (Task 4). `buildWebviewHtml` signature matches between `html.ts`, the test, and `panel.ts`. `openWebview(context, viewId)` matches its call site. `__INITIAL_STATE__` shape `{ viewId }` matches between `html.ts` injection and `index.tsx` read. ✓
