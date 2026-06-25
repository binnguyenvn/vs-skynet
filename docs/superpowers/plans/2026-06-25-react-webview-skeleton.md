# React Webview Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a unified React + Tailwind v4 + full shadcn/ui foundation for the extension's many webviews, themed to track the active VSCode theme, with a gallery proving the theming holds across the whole component library.

**Architecture:** Reuse the existing esbuild build by adding a second browser-target context for one shared webview bundle; each panel opens with a `viewId` and the React app renders the matching view. Tailwind v4 compiles via its CLI; the full shadcn library is installed via the shadcn CLI and its tokens are remapped to VSCode CSS variables.

**Tech Stack:** TypeScript, esbuild, React 19, Tailwind CSS v4 (`@tailwindcss/cli`), shadcn/ui (full library via CLI), class-variance-authority, clsx, tailwind-merge, @radix-ui/*, lucide-react, VSCode Webview API.

## Global Constraints

- VSCode engine: `^1.125.0` (already set).
- Extension build unchanged: `src/extension.ts` → `dist/extension.js` (node/cjs).
- Webview bundle is browser/IIFE → `dist/webview/main.js`; styles → `dist/webview/main.css`.
- No Vite. Webview builds through a second esbuild context + Tailwind CLI.
- Path alias `@/* → src/webview/*` (tsconfig `paths` + esbuild `alias`) — required so shadcn CLI's generated `@/...` imports resolve.
- One shared webview bundle with an internal `switch` on `viewId`; no routing library.
- shadcn theme tokens map to `var(--vscode-*)`; dark/light driven by the `vscode-*` body class — no separate theme toggle.

---

### Task 1: Build pipeline, path alias & full theme tokens

**Files:**
- Modify: `package.json` (deps + scripts)
- Modify: `esbuild.js` (second context + `@` alias)
- Modify: `tsconfig.json` (jsx, DOM lib, path alias)
- Create: `src/webview/index.tsx` (stub, replaced in Task 5)
- Create: `src/webview/styles.css` (Tailwind + full VSCode token map)

**Interfaces:**
- Produces: `dist/webview/main.js` (IIFE bundle), `dist/webview/main.css` (compiled Tailwind), the `@/*` alias, and the full shadcn→vscode token set in CSS. Later tasks rely on all of these.

- [ ] **Step 1: Install dependencies**

```bash
npm i react react-dom class-variance-authority clsx tailwind-merge lucide-react
npm i -D @types/react @types/react-dom tailwindcss @tailwindcss/cli tw-animate-css
```

(Radix packages are pulled transitively by shadcn components in Task 4.)

- [ ] **Step 2: Update `tsconfig.json` — jsx, DOM lib, path alias**

Set `compilerOptions.lib`, and add `jsx`, `baseUrl`, `paths`:

```json
        "lib": [
            "ES2022",
            "DOM",
            "DOM.Iterable"
        ],
        "jsx": "react-jsx",
        "baseUrl": ".",
        "paths": {
            "@/*": ["src/webview/*"]
        },
```

- [ ] **Step 3: Add the second esbuild context + alias in `esbuild.js`**

At the top of the file, after `const esbuild = require("esbuild");`, add:

```js
const path = require("path");
```

Inside `main()`, after the existing extension `ctx`, add the webview context and drive both. Replace the existing `if (watch) { ... } else { ... }` block with:

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
		alias: { '@': path.resolve(__dirname, 'src/webview') },
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

Add to `scripts`:

```json
    "build:css": "tailwindcss -i ./src/webview/styles.css -o ./dist/webview/main.css",
    "watch:css": "tailwindcss -i ./src/webview/styles.css -o ./dist/webview/main.css --watch",
```

Update `compile` and `package`:

```json
    "compile": "npm run check-types && npm run lint && node esbuild.js && npm run build:css",
    "package": "npm run check-types && npm run lint && node esbuild.js --production && npm run build:css",
```

(`watch` stays `npm-run-all -p watch:*`; it now also runs `watch:css`.)

- [ ] **Step 5: Create `src/webview/styles.css` (full theme glue)**

```css
@import "tailwindcss";
@import "tw-animate-css";
@source "./**/*.tsx";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius: var(--radius-base);
}

:root {
  --background: var(--vscode-editor-background);
  --foreground: var(--vscode-foreground);
  --card: var(--vscode-editorWidget-background);
  --card-foreground: var(--vscode-foreground);
  --popover: var(--vscode-editorWidget-background);
  --popover-foreground: var(--vscode-foreground);
  --primary: var(--vscode-button-background);
  --primary-foreground: var(--vscode-button-foreground);
  --secondary: var(--vscode-button-secondaryBackground);
  --secondary-foreground: var(--vscode-button-secondaryForeground);
  --muted: var(--vscode-editorWidget-background);
  --muted-foreground: var(--vscode-descriptionForeground);
  --accent: var(--vscode-list-hoverBackground);
  --accent-foreground: var(--vscode-foreground);
  --destructive: var(--vscode-errorForeground);
  --destructive-foreground: var(--vscode-editor-background);
  --border: var(--vscode-panel-border);
  --input: var(--vscode-input-background);
  --ring: var(--vscode-focusBorder);
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

- [ ] **Step 7: Build and verify outputs**

Run: `npm run compile`
Then: `ls dist/webview/main.js dist/webview/main.css`
Expected: command succeeds; both files listed.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json esbuild.js tsconfig.json src/webview/index.tsx src/webview/styles.css
git commit -m "feat: webview build pipeline, @/ alias, and full vscode theme tokens"
```

---

### Task 2: Message protocol + CSP HTML builder

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

Run: `npm test`
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} https: data:; script-src 'nonce-${nonce}'; font-src ${cspSource};" />
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
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add src/webview/html.ts src/webview/protocol.ts src/test/html.test.ts
git commit -m "feat: webview message protocol and CSP html builder"
```

---

### Task 3: Extension webview helper + commands

**Files:**
- Create: `src/webview/panel.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (contributes.commands)

**Interfaces:**
- Consumes: `buildWebviewHtml`, `nonce` from `./html`; `WebviewToExtension` from `./protocol`.
- Produces: `openWebview(context: vscode.ExtensionContext, viewId: string): vscode.WebviewPanel`.

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

- [ ] **Step 2: Register commands in `src/extension.ts`**

Add the import after the `vscode` import:

```ts
import { openWebview } from "./webview/panel";
```

Inside `activate()`, before `context.subscriptions.push(disposable);`, add:

```ts
	const openPanel = vscode.commands.registerCommand("skynet-harness.openWebview", () => {
		openWebview(context, "hello");
	});
	const openGallery = vscode.commands.registerCommand("skynet-harness.openGallery", () => {
		openWebview(context, "gallery");
	});
	context.subscriptions.push(openPanel, openGallery);
```

- [ ] **Step 3: Add the commands to `package.json`**

In `contributes.commands`, add:

```json
      {
        "command": "skynet-harness.openWebview",
        "title": "Skynet: Open Webview"
      },
      {
        "command": "skynet-harness.openGallery",
        "title": "Skynet: Open Component Gallery"
      }
```

- [ ] **Step 4: Build and type-check**

Run: `npm run compile`
Expected: succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/webview/panel.ts src/extension.ts package.json
git commit -m "feat: openWebview helper and Open Webview/Gallery commands"
```

---

### Task 4: Install the full shadcn/ui library

> **Exploratory — verify as you go.** shadcn has no first-class esbuild preset, so we supply `components.json` by hand and use `add` (not `init`, which would rewrite our token block in `styles.css`). If a command errors, read its output and adapt; the success criterion is `src/webview/components/ui/` populated and `npm run compile` clean.

**Files:**
- Create: `components.json`
- Create (by CLI): `src/webview/lib/utils.ts`, `src/webview/components/ui/*`
- Possibly modify (by CLI): `package.json`, `package-lock.json` (radix deps)

**Interfaces:**
- Consumes: the `@/*` alias, `styles.css` token map (Task 1).
- Produces: `cn()` at `@/lib/utils`; the full shadcn component set under `@/components/ui/*` (e.g. `button`, `card`, `input`, `label`, `checkbox`, `select`, `dialog`, `tabs`, `badge`, `switch`, ...).

- [ ] **Step 1: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/webview/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 2: Add the full component set**

Run: `npx shadcn@latest add --all --yes --overwrite`
Expected: components written under `src/webview/components/ui/`. If `--all` is rejected by the installed CLI version, list explicitly, e.g.:
`npx shadcn@latest add --yes button card input label textarea checkbox switch select radio-group tabs dialog alert badge separator tooltip accordion avatar progress skeleton table`

- [ ] **Step 3: Verify the library landed and still compiles**

Run:
```bash
ls src/webview/components/ui | head
cat src/webview/lib/utils.ts
npm run compile
```
Expected: many `*.tsx` files listed; `utils.ts` exports `cn`; compile succeeds (CSS may warn on unmapped chart/sidebar tokens — only fix if a gallery-used component renders wrong).

- [ ] **Step 4: Confirm the token block survived**

Run: `git diff src/webview/styles.css`
Expected: no change to the `:root` / `@theme inline` blocks from Task 1. If the CLI rewrote them, restore with `git checkout src/webview/styles.css` and re-run compile.

- [ ] **Step 5: Commit**

```bash
git add components.json src/webview/lib src/webview/components package.json package-lock.json
git commit -m "feat: install full shadcn/ui library via cli"
```

---

### Task 5: Webview views — hello round-trip + component gallery

**Files:**
- Create: `src/webview/lib/vscode.ts`
- Create: `src/webview/views/hello.tsx`
- Create: `src/webview/views/gallery.tsx`
- Modify: `src/webview/index.tsx` (replace stub with the view router)

**Interfaces:**
- Consumes: `WebviewToExtension`/`ExtensionToWebview` from `@/protocol`; shadcn components from `@/components/ui/*`; the Task 3 round-trip.
- Produces: `hello` view (Button → message round-trip) and `gallery` view (renders the component set, themed).

- [ ] **Step 1: Create `src/webview/lib/vscode.ts` (typed message bus)**

```ts
import type { ExtensionToWebview, WebviewToExtension } from "@/protocol";

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

- [ ] **Step 2: Create `src/webview/views/hello.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { onMessage, postMessage } from "@/lib/vscode";

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

- [ ] **Step 3: Create `src/webview/views/gallery.tsx`**

Render a representative slice of the installed components, themed. Adjust imports to match what Task 4 actually installed (every import below is a default shadcn component).

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      <Separator />
    </section>
  );
}

export function GalleryView() {
  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl">
      <h1 className="text-lg font-semibold">shadcn × VSCode theme</h1>

      <Section title="Buttons">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </Section>

      <Section title="Badges">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </Section>

      <Section title="Form">
        <div className="flex flex-col gap-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Skynet" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="agree" />
          <Label htmlFor="agree">Agree</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="on" />
          <Label htmlFor="on">Enabled</Label>
        </div>
        <Select>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectItem value="b">Beta</SelectItem>
          </SelectContent>
        </Select>
      </Section>

      <Section title="Tabs & Card">
        <Tabs defaultValue="one" className="w-full">
          <TabsList>
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
              </CardHeader>
              <CardContent>Themed to the editor widget background.</CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="two">Second tab content.</TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/webview/index.tsx` with the view router**

```tsx
import { createRoot } from "react-dom/client";
import { HelloView } from "@/views/hello";
import { GalleryView } from "@/views/gallery";

declare global {
  interface Window {
    __INITIAL_STATE__: { viewId: string };
  }
}

function App({ viewId }: { viewId: string }) {
  switch (viewId) {
    case "hello":
      return <HelloView />;
    case "gallery":
      return <GalleryView />;
    default:
      return <div className="p-4">Unknown view: {viewId}</div>;
  }
}

const { viewId } = window.__INITIAL_STATE__;
createRoot(document.getElementById("root")!).render(<App viewId={viewId} />);
```

- [ ] **Step 5: Build and type-check**

Run: `npm run compile`
Expected: succeeds. If a gallery import doesn't match an installed component name, fix the import to the actual file in `src/webview/components/ui/`.

- [ ] **Step 6: Manual verification (F5)**

Press `F5`, then in the Extension Development Host:
1. Run **"Skynet: Open Webview"** → click the button → toast "Webview says hello: Skynet" + "Hello back, Skynet!" appears.
2. Run **"Skynet: Open Component Gallery"** → all sections render, styled with editor colors (buttons use button colors, inputs use input background, etc.).
3. Switch theme (light ↔ dark ↔ high-contrast) and reopen → components follow the theme.

- [ ] **Step 7: Commit**

```bash
git add src/webview/lib/vscode.ts src/webview/views src/webview/index.tsx
git commit -m "feat: hello round-trip view and themed component gallery"
```

---

## Self-Review

**Spec coverage:**
- Second esbuild context + Tailwind CLI → Task 1. ✓
- Path alias `@/*` → Task 1 (tsconfig + esbuild). ✓
- Full shadcn token map → Task 1 (`styles.css`). ✓
- `openWebview` helper, CSP + nonce + asWebviewUri + injected state → Tasks 2 + 3. ✓
- Shared `protocol.ts` for both sides → Task 2, consumed in 3 & 5. ✓
- Typed message bus → Task 5 (`lib/vscode.ts`). ✓
- Full shadcn library via CLI + `components.json` → Task 4. ✓
- Gallery view + `openGallery` command → Tasks 3 + 5. ✓
- hello round-trip demo → Tasks 3 + 5. ✓
- Commands `openWebview`/`openGallery`, keep `helloWorld` → Task 3. ✓
- Test on HTML/CSP shape → Task 2 (`html.test.ts`). ✓
- Out of scope (routing/state libs, rich per-component demos, Vite) → not added. ✓

**Placeholder scan:** No TBD/TODO. Task 4 is intentionally exploratory with explicit verification + fallback commands, not placeholder text.

**Type consistency:** `WebviewToExtension`/`ExtensionToWebview` defined in Task 2, used identically in `panel.ts` (Task 3) and `lib/vscode.ts` (Task 5). `buildWebviewHtml` signature matches across `html.ts`, the test, and `panel.ts`. `openWebview(context, viewId)` matches both call sites (`hello`, `gallery`). `__INITIAL_STATE__` shape `{ viewId }` matches between `html.ts` injection and `index.tsx` read. `cn` from `@/lib/utils` (Task 4) is used only by CLI-generated components. ✓
