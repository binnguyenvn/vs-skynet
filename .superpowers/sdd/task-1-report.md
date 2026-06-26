# Task 1 Report: Model Catalog service

## Status

DONE_WITH_CONCERNS

## Scope completed

- Added `src/services/model-catalog.ts` implementing the exact catalog surface and tiered load path from the brief:
  - `parseCatalog(text): RawCatalog | null`
  - `selectModels(catalog, company): ModelInfo[]`
  - `ModelCatalog.forContext(context)`
  - `getModelsByCompany(company): Promise<ModelInfo[]>`
- Added `src/services/model-catalog.test.ts` and followed red-green:
  - first run failed because `./model-catalog` did not exist
  - after implementation, focused extension-host tests passed
- Vendored the upstream snapshot into `src/services/models.snapshot.json` using the brief URL
- Added `"refresh:models"` to `package.json`
- Enabled JSON imports in `tsconfig.json`

## Design conformance

- Company set is exactly `'openai' | 'anthropic' | 'google' | 'openrouter' | 'nvidia'`
- Owner-filtered companies match exact `owned_by`
- Aggregators return all models, including entries without `owned_by`
- `displayName` falls back to the model id
- `ownedBy` falls back to `''`
- `aliases` falls back to `[]`
- Loader order is memory -> fresh disk -> fetch -> stale disk -> bundled snapshot
- TTL is `24 * 60 * 60 * 1000`
- Fetch body is shape-validated with `zod`
- Public calls swallow failures and fall back instead of throwing
- Parallel first calls share one in-flight fetch

## Snapshot

- Source URL: `https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json`
- Vendored model count at fetch time: `772`

## Verification

### Red step

Ran:

```bash
npm run compile-tests
```

Observed expected failure before implementation:

```text
src/services/model-catalog.test.ts(8,8): error TS2307: Cannot find module './model-catalog'
```

### Focused checks after implementation

Ran:

```bash
npm run compile-tests
npx vscode-test --run out/services/model-catalog.test.js
```

Result:

- `12 passing`
- covered parser, company selection, snapshot fallback, fresh-disk preference, and shared in-flight fetch behavior

### Required full suite

Ran:

```bash
npm test
```

Result:

- exit code `0`
- compile, build, and baseline extension-host tests passed
- existing warnings remained only in `src/webview/hooks/use-mobile.ts`, unchanged:
  - `11` semicolon warnings

## Concern

- The existing default `npm test` discovery path still only ran the pre-existing extension-host tests (`3 passing`) and did not automatically pick up `src/services/model-catalog.test.ts`. The task’s focused verification covered the new service with `npx vscode-test --run out/services/model-catalog.test.js`, but the repo’s default test discovery is still narrower than the new test file location.

## Commit

- Created commit after verification; see `git log --oneline -1` for the exact SHA/subject in the final handoff.

## Review fixes — 2026-06-26

- Narrowed `src/services/model-catalog.ts` to the intended public surface:
  - kept exported `Company`
  - kept exported `ModelInfo`
  - replaced exported internals/classes with a single public `getModelsByCompany(context, company)` path
  - kept parser, selection, dependency wiring, and service state internal
- Removed `resolveJsonModule` from `tsconfig.json`
- Switched snapshot loading to runtime file reads, preserving committed snapshot fallback without the compiler option
- Updated `.vscode-test.mjs` from `out/test/**/*.test.js` to `out/**/*.test.js` so default `npm test` discovers the service test
- Rewrote `src/services/model-catalog.test.ts` to exercise behavior only through the public API with fixture-driven fetch and real temp-disk cache setup; no internal imports and no network

### Review-fix verification

Red step:

```bash
npm run compile-tests
```

Observed expected failure before the service change:

```text
src/services/model-catalog.test.ts(3,19): error TS2305: Module '"./model-catalog"' has no exported member 'getModelsByCompany'.
```

Focused check after the fix:

```bash
npm run compile-tests
npx vscode-test --run out/services/model-catalog.test.js
```

Result:

- `8 passing`

Required full suite:

```bash
npm test
```

Result:

- `11 passing`
- default discovery now includes `model-catalog`
- unchanged lint warnings remain in `src/webview/hooks/use-mobile.ts` only

## Remaining re-review fixes — 2026-06-26

- Fixed packaged snapshot availability in `esbuild.js` by copying `src/services/models.snapshot.json` to `dist/models.snapshot.json` during non-watch and watch builds, matching the existing runtime `loadSnapshot()` probe order without widening the runtime API or reintroducing `resolveJsonModule`.
- Strengthened `src/services/model-catalog.test.ts` malformed-fetch coverage to assert the returned value exactly matches snapshot-derived `ModelInfo[]` mapping for `anthropic`, instead of only asserting a non-empty result.

### Remaining re-review verification

Red step for the packaging regression:

```bash
node esbuild.js --production >/tmp/task1-esbuild.log 2>&1; test -f dist/models.snapshot.json
```

Observed expected failure before the `esbuild.js` fix:

- exit code `1`
- `dist/models.snapshot.json` was missing after the production build

Focused checks after the fix:

```bash
node esbuild.js --production >/tmp/task1-esbuild.log 2>&1; test -f dist/models.snapshot.json
npm run compile-tests
npx vscode-test --run out/services/model-catalog.test.js
```

Result:

- production build now leaves `dist/models.snapshot.json` in place
- `8 passing` in `model-catalog.test.js`
- malformed fetched JSON path now proves exact snapshot-mapped fallback data

Required full suite:

```bash
npm test
```

Result:

- exit code `0`
- `11 passing`
- unchanged lint warnings remain in `src/webview/hooks/use-mobile.ts` only

## Whole-branch final review fixes — 2026-06-26

- Added a native fetch timeout in `src/services/model-catalog.ts` with `AbortSignal.timeout(250)` so a stalled upstream request falls back instead of hanging `getModelsByCompany()`.
- Copied `aliases` on read with `aliases: [...(entry.aliases ?? [])]` so caller mutation cannot leak back into cached catalog results.
- Tightened `refresh:models` to `curl -fsSL` in `package.json`.
- Added focused regression coverage in `src/services/model-catalog.test.ts` for:
  - a hung fetch that aborts and falls back to snapshot data within the timeout window
  - alias-array mutation not affecting later reads from the cached catalog

### Whole-branch final review verification

Focused checks:

```bash
npm run compile-tests
npx vscode-test --run out/services/model-catalog.test.js --grep "hung fetch times out and falls back to snapshot data|returned aliases are copied from cached catalog data"
```

Result:

- `2 passing`
- timeout fallback completed in about `264ms`

Required full suite:

```bash
npm run check-types
npm run lint
npm test
```

Result:

- `npm test` exit code `0`
- `13 passing`
- existing lint warnings remain only in `src/webview/hooks/use-mobile.ts` (outside owned scope), unchanged
