# Tree Component — Design

## Goal

Add generic, reusable tree primitives to the shadcn component library so a
VSCode-style sidebar (like `.temp/worker.png`: PROVIDERS panel with CLOUD/LOCAL
groups and provider rows) can be composed from them. The components are the
deliverable; the provider sidebar is a static showcase that demonstrates them.

Static showcase only — no real data, no extension-host messaging, no filter logic.

## Components

New file: `src/webview/components/ui/tree.tsx`. Composition-style, matching the
other shadcn primitives in the repo.

### `Tree`
Root container. `role="tree"`, flex column. Wraps `TreeGroup`/`TreeItem`.

### `TreeGroup`
Collapsible section, built on the existing `Collapsible` primitive.
- Header: chevron (rotates on open) + uppercase label + count `Badge` (right-aligned).
- Body: children (`TreeItem`s).
- Props: `label: string`, `count?: number`, `defaultExpanded?: boolean`.

### `TreeItem`
Leaf row.
- Layout: optional icon square + `label` + optional `meta` (muted secondary line) + status dot (right).
- Props: `icon?: React.ReactNode`, `label: string`, `meta?: string`,
  `status?: ProviderStatus`, `selected?: boolean`, `onClick?: () => void`.

### Item statuses
`type TreeItemStatus = "online" | "degraded" | "offline"`.
- `online`  → emerald dot
- `degraded`→ amber dot + amber `meta` text
- `offline` → zinc dot + dimmed/muted row
- `selected`→ accent background (`bg-accent`/sidebar accent token)
- none      → no dot

Status colors are Tailwind semantic colors (emerald/amber/zinc), not VSCode
theme chrome, since they signal state.

## Example API

```tsx
<Tree>
  <TreeGroup label="CLOUD" count={3} defaultExpanded>
    <TreeItem icon={<OpenAIIcon/>} label="OpenAI" meta="47 models · 142ms avg" status="online" selected />
    <TreeItem icon={<AnthropicIcon/>} label="Anthropic" meta="12 models · 198ms avg" status="online" />
    <TreeItem icon={<GeminiIcon/>} label="Gemini" meta="Degraded · high latency" status="degraded" />
  </TreeGroup>
  <TreeGroup label="LOCAL" count={2} defaultExpanded>
    <TreeItem icon={<OllamaIcon/>} label="Ollama" meta="localhost:11434 · offline" status="offline" />
    <TreeItem icon={<LMStudioIcon/>} label="LM Studio" meta="5 models · localhost:1234" status="online" />
  </TreeGroup>
</Tree>
```

## Showcase

Add one `<Section title="Tree">` to `src/webview/views/gallery.tsx` rendering the
above in a fixed-width (~260px) bordered frame, reproducing the reference image.
Icon squares = small rounded colored squares with a glyph/letter (sample data).

## Skipped (YAGNI — add when needed)

- Data-driven `<Tree data={...} />` API — composition is enough for now.
- Search/filter logic — input not part of these primitives.
- Keyboard navigation / full ARIA (`aria-expanded`, roving tabindex).
- Nesting deeper than group → item.
- Real provider data / extension messaging.
