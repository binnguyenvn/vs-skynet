# Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extension-host service that turns the upstream `models.json` into `getModelsByCompany(company) → ModelInfo[]`, with live fetch + 24h disk cache + bundled snapshot fallback, never throwing.

**Architecture:** One file `src/services/model-catalog.ts` holding (a) pure functions `parseCatalog`/`selectModels` and (b) a `ModelCatalog` class whose tiered loader (memory → fresh disk → live fetch → stale disk → bundled snapshot) is driven by an injectable `CatalogDeps` IO seam so the fallback path is testable without vscode/network. The bundled fallback is `src/services/models.snapshot.json`, imported into the esbuild bundle.

**Tech Stack:** TypeScript (Node16 module, ES2022), `zod` v4 (shape validation), VS Code extension API (`workspace.fs`, `globalStorageUri`), global `fetch`, mocha + `assert` via `@vscode/test-cli`.

## Global Constraints

- VS Code engine `^1.125.0`; runtime Node 20 — global `fetch` is available, no fetch polyfill.
- `zod` is already a dependency — do NOT add new dependencies.
- `Company` type is exactly `'openai' | 'anthropic' | 'google' | 'openrouter' | 'nvidia'`.
- A public call (`getModelsByCompany`) MUST NOT throw — worst case returns bundled-snapshot data; failures are `console.error`-logged and swallowed.
- Cache TTL is `24h` (`24 * 60 * 60 * 1000` ms).
- Owner-filter companies (`openai`/`anthropic`/`google`) match `owned_by === company` and drop models with no `owned_by`; aggregators (`openrouter`/`nvidia`) return all models.
- Tests live under `src/test/` (compiled to `out/test/**/*.test.js`, the only path the test runner globs).
- Remote URL: `https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json`.

---

## File Structure

- Create: `src/services/model-catalog.ts` — types, pure `parseCatalog`/`selectModels`, `ModelCatalog` class + `defaultDeps`.
- Create: `src/services/models.snapshot.json` — vendored copy of upstream (offline fallback), via `npm run refresh:models`.
- Create: `src/test/model-catalog.test.ts` — mocha tests for the pure functions and the tiered loader.
- Modify: `tsconfig.json` — add `"resolveJsonModule": true` (to import the snapshot JSON).
- Modify: `package.json` — add `"refresh:models"` script.

No `src/extension.ts` change: nothing consumes the service yet. Wiring (and any webview model-picker) lands with the Worker feature that consumes it — out of scope here, per the spec.

---

### Task 1: Pure core — types, parser, mapper, snapshot

**Files:**
- Create: `src/services/model-catalog.ts`
- Create: `src/services/models.snapshot.json`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Test: `src/test/model-catalog.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `type Company = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'nvidia'`
  - `type ModelInfo = { id: string; displayName: string; ownedBy: string; aliases: string[] }`
  - `type RawCatalog = { models: Record<string, { display_name?: string; owned_by?: string; aliases?: string[] }> }`
  - `function parseCatalog(text: string): RawCatalog | null`
  - `function selectModels(catalog: RawCatalog, company: Company): ModelInfo[]`

- [ ] **Step 1: Enable JSON imports in tsconfig**

In `tsconfig.json`, add `"resolveJsonModule": true` inside `compilerOptions` (next to `"module": "Node16"`):

```jsonc
"module": "Node16",
"resolveJsonModule": true,
```

- [ ] **Step 2: Add the snapshot-refresh script**

In `package.json` `scripts`, add:

```jsonc
"refresh:models": "curl -sSL https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json -o src/services/models.snapshot.json",
```

- [ ] **Step 3: Vendor the snapshot file**

Run: `npm run refresh:models`
Expected: `src/services/models.snapshot.json` exists and starts with `{"models":` (a few hundred KB). Verify:
Run: `node -e "console.log(Object.keys(require('./src/services/models.snapshot.json').models).length)"`
Expected: a number in the hundreds (e.g. `500`).

- [ ] **Step 4: Write the failing test for `parseCatalog` and `selectModels`**

Create `src/test/model-catalog.test.ts`:

```ts
import * as assert from 'assert';
import { parseCatalog, selectModels, RawCatalog } from '../services/model-catalog';

const FIXTURE: RawCatalog = {
  models: {
    'claude-opus-4-5': { display_name: 'Claude Opus 4.5', owned_by: 'anthropic', aliases: ['claude-opus-4.5'] },
    'gpt-5': { display_name: 'GPT-5', owned_by: 'openai' },
    'no-display': { owned_by: 'anthropic' },
    'flux-pro': {}, // no owned_by, no display_name
  },
};

suite('model-catalog: pure', () => {
  test('parseCatalog parses a valid catalog', () => {
    const parsed = parseCatalog(JSON.stringify(FIXTURE));
    assert.ok(parsed);
    assert.strictEqual(Object.keys(parsed!.models).length, 4);
  });

  test('parseCatalog returns null on malformed JSON', () => {
    assert.strictEqual(parseCatalog('{ not json'), null);
  });

  test('parseCatalog returns null when shape is wrong', () => {
    assert.strictEqual(parseCatalog(JSON.stringify({ nope: 1 })), null);
  });

  test('owner filter returns only matching owned_by', () => {
    const ids = selectModels(FIXTURE, 'anthropic').map((m) => m.id).sort();
    assert.deepStrictEqual(ids, ['claude-opus-4-5', 'no-display']);
  });

  test('owner filter excludes models with no owned_by', () => {
    const ids = selectModels(FIXTURE, 'openai').map((m) => m.id);
    assert.deepStrictEqual(ids, ['gpt-5']); // flux-pro (no owned_by) excluded
  });

  test('aggregator returns all models incl. no owned_by', () => {
    const ids = selectModels(FIXTURE, 'openrouter').map((m) => m.id).sort();
    assert.deepStrictEqual(ids, ['claude-opus-4-5', 'flux-pro', 'gpt-5', 'no-display']);
  });

  test('displayName falls back to id; ownedBy/aliases default', () => {
    const flux = selectModels(FIXTURE, 'nvidia').find((m) => m.id === 'flux-pro')!;
    assert.strictEqual(flux.displayName, 'flux-pro');
    assert.strictEqual(flux.ownedBy, '');
    assert.deepStrictEqual(flux.aliases, []);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm run compile-tests && npx vscode-test --label model-catalog 2>/dev/null || npm test`
Expected: FAIL — `Cannot find module '../services/model-catalog'` (file not created yet).

- [ ] **Step 6: Write `model-catalog.ts` pure core**

Create `src/services/model-catalog.ts`:

```ts
import { z } from 'zod';

export type Company = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'nvidia';

export type ModelInfo = {
  id: string;          // object key — the string used to call the model
  displayName: string; // display_name, or id when absent
  ownedBy: string;     // raw owned_by, or '' when absent
  aliases: string[];   // aliases, or []
};

const ModelEntry = z.object({
  display_name: z.string().optional(),
  owned_by: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

const CatalogSchema = z.object({
  models: z.record(z.string(), ModelEntry),
});

export type RawCatalog = z.infer<typeof CatalogSchema>;

const AGGREGATORS = new Set<Company>(['openrouter', 'nvidia']);

/** Parse + shape-validate raw text. Returns null on bad JSON or wrong shape (never throws). */
export function parseCatalog(text: string): RawCatalog | null {
  try {
    const result = CatalogSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Map a catalog to the callable models for a Company. */
export function selectModels(catalog: RawCatalog, company: Company): ModelInfo[] {
  const all = AGGREGATORS.has(company);
  const out: ModelInfo[] = [];
  for (const [id, entry] of Object.entries(catalog.models)) {
    const ownedBy = entry.owned_by ?? '';
    if (!all && ownedBy !== company) {
      continue;
    }
    out.push({
      id,
      displayName: entry.display_name ?? id,
      ownedBy,
      aliases: entry.aliases ?? [],
    });
  }
  return out;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run compile-tests && npm test`
Expected: PASS — all 7 `model-catalog: pure` tests green.

- [ ] **Step 8: Commit**

```bash
git add src/services/model-catalog.ts src/services/models.snapshot.json src/test/model-catalog.test.ts tsconfig.json package.json
git commit -m "feat: model-catalog pure core (parse + company filter) + snapshot"
```

---

### Task 2: Tiered loader — `ModelCatalog` (memory → disk → fetch → snapshot)

**Files:**
- Modify: `src/services/model-catalog.ts`
- Test: `src/test/model-catalog.test.ts`

**Interfaces:**
- Consumes (from Task 1): `Company`, `ModelInfo`, `RawCatalog`, `parseCatalog`, `selectModels`.
- Produces:
  - `type CatalogDeps = { ttlMs: number; snapshot: RawCatalog; fetchText(): Promise<string>; readDiskText(): Promise<string | null>; writeDiskText(text: string): Promise<void>; diskAgeMs(): Promise<number | null> }`
  - `class ModelCatalog` with `constructor(deps: CatalogDeps)`, static `ModelCatalog.forContext(ctx: vscode.ExtensionContext): ModelCatalog`, and `getModelsByCompany(company: Company): Promise<ModelInfo[]>`.

- [ ] **Step 1: Write the failing tests for the tiered loader**

Append to `src/test/model-catalog.test.ts`:

```ts
import { ModelCatalog, CatalogDeps } from '../services/model-catalog';

const SNAP: RawCatalog = { models: { 'snap-model': { display_name: 'Snap', owned_by: 'anthropic' } } };
const REMOTE: RawCatalog = { models: { 'live-model': { display_name: 'Live', owned_by: 'anthropic' } } };

function fakeDeps(over: Partial<CatalogDeps>): CatalogDeps {
  return {
    ttlMs: 1000,
    snapshot: SNAP,
    fetchText: async () => { throw new Error('offline'); },
    readDiskText: async () => null,
    writeDiskText: async () => {},
    diskAgeMs: async () => null,
    ...over,
  };
}

suite('model-catalog: tiered loader', () => {
  test('fetch ok + valid → returns live data and writes disk', async () => {
    let written: string | null = null;
    const cat = new ModelCatalog(fakeDeps({
      fetchText: async () => JSON.stringify(REMOTE),
      writeDiskText: async (t) => { written = t; },
    }));
    const ids = (await cat.getModelsByCompany('anthropic')).map((m) => m.id);
    assert.deepStrictEqual(ids, ['live-model']);
    assert.ok(written && written.includes('live-model'));
  });

  test('fetch throws + no disk → snapshot fallback (no throw)', async () => {
    const cat = new ModelCatalog(fakeDeps({}));
    const ids = (await cat.getModelsByCompany('anthropic')).map((m) => m.id);
    assert.deepStrictEqual(ids, ['snap-model']);
  });

  test('fetch returns malformed + no disk → snapshot fallback', async () => {
    const cat = new ModelCatalog(fakeDeps({ fetchText: async () => '{ broken' }));
    const ids = (await cat.getModelsByCompany('anthropic')).map((m) => m.id);
    assert.deepStrictEqual(ids, ['snap-model']);
  });

  test('fresh disk → used without fetching', async () => {
    let fetched = false;
    const cat = new ModelCatalog(fakeDeps({
      diskAgeMs: async () => 500, // < ttlMs 1000 → fresh
      readDiskText: async () => JSON.stringify(REMOTE),
      fetchText: async () => { fetched = true; throw new Error('should not fetch'); },
    }));
    const ids = (await cat.getModelsByCompany('anthropic')).map((m) => m.id);
    assert.deepStrictEqual(ids, ['live-model']);
    assert.strictEqual(fetched, false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run compile-tests && npm test`
Expected: FAIL — `ModelCatalog`/`CatalogDeps` not exported from `../services/model-catalog`.

- [ ] **Step 3: Add the loader to `model-catalog.ts`**

Add these imports at the top of `src/services/model-catalog.ts`:

```ts
import * as vscode from 'vscode';
import snapshotData from './models.snapshot.json';
```

Append to the end of `src/services/model-catalog.ts`:

```ts
const REMOTE_URL =
  'https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const snapParse = CatalogSchema.safeParse(snapshotData);
const BUNDLED_SNAPSHOT: RawCatalog = snapParse.success ? snapParse.data : { models: {} };

export type CatalogDeps = {
  ttlMs: number;
  snapshot: RawCatalog;
  fetchText(): Promise<string>;            // remote fetch (throws on network/HTTP error)
  readDiskText(): Promise<string | null>;  // null when cache file absent
  writeDiskText(text: string): Promise<void>;
  diskAgeMs(): Promise<number | null>;     // ms since cache mtime, null when absent
};

function defaultDeps(ctx: vscode.ExtensionContext): CatalogDeps {
  const dir = ctx.globalStorageUri;
  const file = vscode.Uri.joinPath(dir, 'models.cache.json');
  return {
    ttlMs: DEFAULT_TTL_MS,
    snapshot: BUNDLED_SNAPSHOT,
    async fetchText() {
      const res = await fetch(REMOTE_URL);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.text();
    },
    async readDiskText() {
      try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
      } catch {
        return null;
      }
    },
    async writeDiskText(text) {
      await vscode.workspace.fs.createDirectory(dir);
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
    },
    async diskAgeMs() {
      try {
        const stat = await vscode.workspace.fs.stat(file);
        return Date.now() - stat.mtime;
      } catch {
        return null;
      }
    },
  };
}

export class ModelCatalog {
  private memo: RawCatalog | null = null;
  private inflight: Promise<RawCatalog> | null = null;

  constructor(private deps: CatalogDeps) {}

  static forContext(ctx: vscode.ExtensionContext): ModelCatalog {
    return new ModelCatalog(defaultDeps(ctx));
  }

  async getModelsByCompany(company: Company): Promise<ModelInfo[]> {
    return selectModels(await this.load(), company);
  }

  private async load(): Promise<RawCatalog> {
    if (this.memo) {
      return this.memo;
    }
    if (!this.inflight) {
      this.inflight = this.loadUncached().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  // memoize only authoritative results (fresh disk / successful fetch); stale-disk and
  // snapshot fallbacks are returned un-memoized so a later call retries the network.
  private async loadUncached(): Promise<RawCatalog> {
    const d = this.deps;

    const age = await d.diskAgeMs();
    if (age !== null && age < d.ttlMs) {
      const fresh = parseCatalog((await d.readDiskText()) ?? '');
      if (fresh) {
        return (this.memo = fresh);
      }
    }

    try {
      const text = await d.fetchText();
      const parsed = parseCatalog(text);
      if (parsed) {
        await d.writeDiskText(text);
        return (this.memo = parsed);
      }
    } catch (err) {
      console.error('[model-catalog] fetch failed:', err);
    }

    const stale = parseCatalog((await d.readDiskText()) ?? '');
    if (stale) {
      return stale;
    }
    return d.snapshot;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run compile-tests && npm test`
Expected: PASS — all `model-catalog: pure` and `model-catalog: tiered loader` tests green.

- [ ] **Step 5: Type-check and lint**

Run: `npm run check-types && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/model-catalog.ts src/test/model-catalog.test.ts
git commit -m "feat: model-catalog tiered loader (disk cache + fetch + snapshot fallback)"
```

---

## Self-Review

**Spec coverage:**
- §2 extension-host, one file + snapshot + test → Task 1 (file/snapshot) + Task 2 (loader). ✓
- §3 optional `owned_by`/`display_name`, id-is-key → `selectModels` defaults + Task 1 tests. ✓
- §4 API `getModelsByCompany`, `ModelInfo` shape, owner-vs-aggregator mapping → Task 1 `selectModels` + Task 2 class. ✓
- §5 3-tier flow, 24h TTL, zod validation, never-throws, shared in-flight promise → Task 2 `loadUncached` + `inflight`. ✓
- §6 snapshot refresh script → Task 1 Step 2. ✓
- §7 error table (offline, malformed, empty, missing fields) → Task 1 + Task 2 tests cover each row. ✓
- §8 testing list → Task 1 (5 pure assertions) + Task 2 (fallback/no-throw). ✓
- §9 out-of-scope items → none built. ✓

**Placeholder scan:** none — all steps carry full code/commands.

**Type consistency:** `Company`, `ModelInfo`, `RawCatalog`, `parseCatalog`, `selectModels`, `CatalogDeps`, `ModelCatalog.getModelsByCompany`/`forContext` names match between Task 1, Task 2, and tests. ✓

**Note on test runner command:** `npm test` runs the full `vscode-test` suite (downloads a VS Code build on first run). All assertions run in the extension host where the `vscode` module and the bundled snapshot import resolve.
