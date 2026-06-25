# Tree Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic `Tree` / `TreeGroup` / `TreeItem` primitives to the shadcn component library and showcase them as a VSCode-style provider sidebar in the gallery.

**Architecture:** One new composition-style primitive file (`tree.tsx`) built on the existing `Collapsible` and `Badge` primitives. A new `<Section>` in `gallery.tsx` composes the primitives with hardcoded sample data to reproduce `.temp/worker.png`. Static showcase — no data layer, no messaging.

**Tech Stack:** React, TypeScript, Tailwind, shadcn/ui, lucide-react.

## Global Constraints

- No new npm dependencies — use only what's installed (`Collapsible`, `Badge`, `cn`, `lucide-react`).
- No React test runner exists; `npm test` (`vscode-test`) is for the extension host only. **Per-task verification is `npm run check-types` + `npm run lint`, plus visual check via the gallery.** Do not add a test framework.
- Match existing shadcn primitive conventions: `cn()` for class merging, `data-slot` attrs, forwardRef-free function components as used in the repo's other `ui/*.tsx` files.
- Status colors are Tailwind semantic colors (emerald/amber/zinc), not VSCode theme tokens.

---

### Task 1: Tree primitives

**Files:**
- Create: `src/webview/components/ui/tree.tsx`

**Interfaces:**
- Consumes: `Collapsible, CollapsibleTrigger, CollapsibleContent` from `@/components/ui/collapsible`; `Badge` from `@/components/ui/badge`; `cn` from `@/lib/utils`; `ChevronRightIcon` from `lucide-react`.
- Produces:
  - `Tree(props: React.ComponentProps<"div">)` — root container.
  - `type TreeItemStatus = "online" | "degraded" | "offline"`.
  - `TreeGroup(props: { label: string; count?: number; defaultExpanded?: boolean; children: React.ReactNode })`.
  - `TreeItem(props: { icon?: React.ReactNode; label: string; meta?: string; status?: TreeItemStatus; selected?: boolean; onClick?: () => void })`.

- [ ] **Step 1: Write the component file**

```tsx
import * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TreeItemStatus = "online" | "degraded" | "offline";

const STATUS_DOT: Record<TreeItemStatus, string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-zinc-500",
};

function Tree({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="tree"
      data-slot="tree"
      className={cn("flex flex-col gap-1 text-sm select-none", className)}
      {...props}
    />
  );
}

function TreeGroup({
  label,
  count,
  defaultExpanded = true,
  children,
}: {
  label: string;
  count?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultExpanded} className="group/tree-group" data-slot="tree-group">
      <CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/tree-group:rotate-90" />
        <span className="flex-1 text-left">{label}</span>
        {count !== undefined && (
          <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[10px]">
            {count}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function TreeItem({
  icon,
  label,
  meta,
  status,
  selected,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  meta?: string;
  status?: TreeItemStatus;
  selected?: boolean;
  onClick?: () => void;
}) {
  const offline = status === "offline";
  return (
    <div
      role="treeitem"
      data-slot="tree-item"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1.5 pl-4",
        "cursor-pointer hover:bg-accent/50",
        selected && "bg-accent",
        offline && "opacity-60",
      )}
    >
      {icon && <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate">{label}</span>
        {meta && (
          <span
            className={cn(
              "truncate text-xs",
              status === "degraded" ? "text-amber-500" : "text-muted-foreground",
            )}
          >
            {meta}
          </span>
        )}
      </div>
      {status && <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />}
    </div>
  );
}

export { Tree, TreeGroup, TreeItem };
```

- [ ] **Step 2: Verify types and lint**

Run: `npm run check-types && npm run lint`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/webview/components/ui/tree.tsx
git commit -m "feat: add Tree/TreeGroup/TreeItem primitives"
```

---

### Task 2: Provider sidebar showcase in gallery

**Files:**
- Modify: `src/webview/views/gallery.tsx`

**Interfaces:**
- Consumes: `Tree, TreeGroup, TreeItem` from `@/components/ui/tree`.
- Produces: a rendered `<Section title="Tree">` (no exported symbols).

- [ ] **Step 1: Import the primitives**

Add near the other `@/components/ui/*` imports in `gallery.tsx`:

```tsx
import { Tree, TreeGroup, TreeItem } from "@/components/ui/tree";
```

- [ ] **Step 2: Add a helper for the colored icon square**

Place above the `Section` helper in `gallery.tsx`:

```tsx
function ProviderIcon({ color, glyph }: { color: string; glyph: string }) {
  return (
    <span
      className="flex size-6 items-center justify-center rounded-md text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {glyph}
    </span>
  );
}
```

- [ ] **Step 3: Add the showcase Section**

Insert a new `<Section title="Tree">` inside `GalleryView`'s content column (e.g. just before the closing Footer comment):

```tsx
<Section title="Tree">
  <div className="w-[260px] rounded-md border bg-card p-1">
    <Tree>
      <TreeGroup label="Cloud" count={3}>
        <TreeItem
          icon={<ProviderIcon color="#10a37f" glyph="AI" />}
          label="OpenAI"
          meta="47 models · 142ms avg"
          status="online"
          selected
        />
        <TreeItem
          icon={<ProviderIcon color="#d97757" glyph="A" />}
          label="Anthropic"
          meta="12 models · 198ms avg"
          status="online"
        />
        <TreeItem
          icon={<ProviderIcon color="#4285f4" glyph="G" />}
          label="Gemini"
          meta="Degraded · high latency"
          status="degraded"
        />
      </TreeGroup>
      <TreeGroup label="Local" count={2}>
        <TreeItem
          icon={<ProviderIcon color="#71717a" glyph="O" />}
          label="Ollama"
          meta="localhost:11434 · offline"
          status="offline"
        />
        <TreeItem
          icon={<ProviderIcon color="#7c3aed" glyph="LM" />}
          label="LM Studio"
          meta="5 models · localhost:1234"
          status="online"
        />
      </TreeGroup>
    </Tree>
  </div>
</Section>
```

- [ ] **Step 4: Verify types and lint**

Run: `npm run check-types && npm run lint`
Expected: PASS.

- [ ] **Step 5: Visual check**

Run: `npm run compile`, then in VSCode launch the extension (F5) and run command "Skynet: Open Component Gallery". Confirm the Tree section renders the CLOUD/LOCAL groups, selected OpenAI row, amber Gemini "degraded", and dimmed offline Ollama — matching `.temp/worker.png`.

- [ ] **Step 6: Commit**

```bash
git add src/webview/views/gallery.tsx
git commit -m "feat: showcase Tree as provider sidebar in gallery"
```

---

## Self-Review

- **Spec coverage:** Tree/TreeGroup/TreeItem (Task 1) + statuses online/degraded/offline/selected (Task 1) + showcase Section reproducing the image (Task 2). All spec sections covered.
- **Placeholders:** none — full code in every code step.
- **Type consistency:** `TreeItemStatus`, prop names (`label`, `meta`, `count`, `status`, `selected`, `defaultExpanded`) match between Task 1 definition and Task 2 usage. `ProviderIcon` glyph/color props consistent.
- **Verification reality:** no React test runner exists; verification is type-check + lint + visual, per Global Constraints.
