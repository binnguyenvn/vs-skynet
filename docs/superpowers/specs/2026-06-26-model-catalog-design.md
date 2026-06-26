# Model Catalog — Design

**Date:** 2026-06-26
**Status:** Draft

> A small extension-host **service** that turns the public
> [`ENTERPILOT/ai-model-list/models.json`](https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json)
> into the answer to one question: *which model names can I call for a given
> Company?* It is the source of model identities the [Worker](2026-06-26-worker-design.md)
> uses when assembling an Agent.

---

## 1. Goal & value proposition

The Worker's Agent is "a **Model** from a **Company**." Something has to know the
list of real, current model ids per Company so the operator can pick one and the
runtime can call it. That something is the **Model Catalog service**.

It does exactly one job: `getModelsByCompany(company)` → a list of callable
models. It is **not** a router, not a pricing engine, not a capability filter —
just the catalog.

The upstream data is community-maintained and updates often (new models ship
weekly), so the service reads it **live** but never *depends* on the network being
up: it always has an answer.

---

## 2. Where it runs

**Extension host (Node)** — not the webview.

- It needs `fetch` and a disk cache (`context.globalStorageUri`); the webview has
  neither cleanly.
- If the webview ever needs the list (e.g. a model-picker UI), it requests it over
  the existing `src/webview/protocol.ts` message channel — the service stays host-side.

**Files:**

```
src/services/model-catalog.ts        # the service (one file)
src/services/models.snapshot.json    # committed bundled fallback (a fetched copy)
src/services/model-catalog.test.ts   # one test file
```

---

## 3. Data source: the upstream JSON

Top-level shape:

```jsonc
{
  "models": {
    "claude-opus-4-5": {
      "display_name": "Claude Opus 4.5",
      "owned_by": "anthropic",
      "aliases": ["claude-opus-4.5", "claude-opus-4-5-20250929"],
      "capabilities": { "function_calling": true, ... },
      "context_window": 1000000,
      "max_output_tokens": ...,
      "pricing": { ... }
    },
    "FLUX-1.1-pro": {
      "display_name": "Flux 1 1 Pro",
      "modes": ["image_generation"]
      // note: NO owned_by
    }
    // ~500 entries
  }
}
```

Facts that drive the design:

- The model **id is the object key** — that is the string you call with.
- **`owned_by` is optional.** Many models (e.g. image-gen) omit it.
- `owned_by` values are **true owners** (`anthropic`, `openai`, `google`, `meta`,
  `mistral`, `deepseek`, …) — *not* the Worker's full Company set.

---

## 4. Public API

```ts
type Company = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'nvidia';

type ModelInfo = {
  id: string;          // object key — the string used to call the model
  displayName: string; // display_name (fallback: id, if upstream omits it)
  ownedBy: string;     // raw owned_by, or '' when absent
  aliases: string[];   // aliases, or []
};

getModelsByCompany(company: Company): Promise<ModelInfo[]>
```

That's the whole surface. One function.

### Company → models mapping

| Company      | Rule                                            |
|--------------|-------------------------------------------------|
| `openai`     | models where `owned_by === 'openai'`            |
| `anthropic`  | models where `owned_by === 'anthropic'`         |
| `google`     | models where `owned_by === 'google'`            |
| `openrouter` | **all** models (aggregator — resells everyone)  |
| `nvidia`     | **all** models (aggregator — resells everyone)  |

- Owner-filtered companies **drop** models with no `owned_by` (can't match).
- Aggregators **keep** them (they're served regardless of owner).
- An empty list is a valid answer (e.g. `openai` before the data has any), **not**
  an error.

> The owner→Company match is by exact `owned_by` string. If upstream renames an
> owner, that owner's models simply stop appearing under the owner-filtered
> Company until the mapping is updated — a visible, harmless degradation, never a
> crash.

---

## 5. Data flow — fetch + cache + bundled fallback

Three tiers, checked in order on each call:

```
getModelsByCompany(company)
  │
  ├─ in-memory cache (this session) ──── present?  → map + return
  │
  ├─ disk cache (globalStorage)     ──── fresh (< TTL)?  → load, hold in memory, map + return
  │
  ├─ fetch(REMOTE_URL)              ──── 200 + valid?  → write disk, hold in memory, map + return
  │
  └─ bundled models.snapshot.json   ──── always works   → hold in memory, map + return
```

- **TTL: 24h.** A disk cache older than that triggers a fetch; if the fetch fails,
  the stale disk copy (or snapshot) is still used — staleness never blocks a call.
- The fetched body is **validated with `zod`** (already a project dependency)
  before it's trusted or written to disk. Invalid body → treat as fetch failure →
  fall through to disk/snapshot. This stops an upstream schema break from poisoning
  the cache.
- **Never throws** from a public call. Worst case = bundled snapshot data. Fetch /
  parse failures are logged (output channel / `console`) and swallowed.
- Concurrency: a single in-flight fetch promise is shared, so parallel first calls
  don't each hit the network.

### Validation scope (lazy on purpose)

`zod` validates only what the service reads: `{ models: Record<string, { display_name?, owned_by?, aliases? }> }`
with everything optional and unknown keys passed through. It is a *shape gate*, not
a full schema of all 500 entries' capabilities/pricing. — `// ponytail: validate
only fields we read; widen if we ever surface capabilities/pricing`.

---

## 6. Snapshot refresh

`models.snapshot.json` is just a committed copy of the upstream file — today's
fetch. It is the offline floor, so it should be re-vendored occasionally (it can be
stale; the live fetch covers freshness in normal use).

One npm script, no codegen:

```jsonc
// package.json scripts
"refresh:models": "curl -sSL https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json -o src/services/models.snapshot.json"
```

Run it manually when the snapshot drifts; commit the result.

---

## 7. Error handling summary

| Situation                          | Behavior                                  |
|------------------------------------|-------------------------------------------|
| Offline / fetch fails              | Use disk cache; else bundled snapshot     |
| Upstream returns malformed JSON    | zod rejects → treated as fetch failure    |
| Company has no matching models     | Return `[]` (valid, not an error)         |
| Model missing `owned_by`           | Excluded from owner filter; kept for aggregators |
| Model missing `display_name`       | `displayName` falls back to `id`          |

The service has **no throwing path** reachable by a caller.

---

## 8. Testing

One file, fixture-driven (no network in tests):

- `getModelsByCompany('anthropic')` → only `owned_by === 'anthropic'` entries.
- `getModelsByCompany('openrouter')` → **all** entries (including no-`owned_by` ones).
- A model with no `owned_by` is **absent** from an owner-filtered result.
- `displayName` falls back to `id` when `display_name` is missing.
- Malformed fetched JSON → service returns mapped **snapshot** data (no throw).

No framework beyond the existing `vscode-test` / mocha setup; the mapper and
fallback logic are pure and tested directly against fixtures.

---

## 9. Out of scope (YAGNI)

Deliberately **not** built until a consumer needs it:

- `resolveModel(idOrAlias)` — alias → canonical id resolution.
- Capability / context-window / pricing filters or richer `ModelInfo` fields.
- Webview model-picker UI (separate feature; consumes this service over `protocol.ts`).
- Auto-refresh scheduling beyond the 24h-TTL-on-call behavior.

Each is a clean addition on top of the one-function surface, not a rewrite.
