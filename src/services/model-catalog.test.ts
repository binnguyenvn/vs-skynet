import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Company, ModelInfo, getModelsByCompany } from "./model-catalog";

type CatalogFixture = {
  models: Record<
    string,
    {
      display_name?: string;
      owned_by?: string;
      aliases?: string[];
    }
  >;
};

const CACHE_FILE = "model-catalog.json";

const DISK_FIXTURE: CatalogFixture = {
  models: {
    "claude-opus-4-5": {
      display_name: "Claude Opus 4.5",
      owned_by: "anthropic",
      aliases: ["claude-opus-4.5"],
    },
    "gpt-5": {
      display_name: "GPT-5",
      owned_by: "openai",
    },
    "no-display": {
      owned_by: "anthropic",
    },
    "flux-pro": {},
  },
};

const REMOTE_FIXTURE: CatalogFixture = {
  models: {
    "live-model": {
      display_name: "Live",
      owned_by: "anthropic",
    },
  },
};

function createContext(storagePath: string): vscode.ExtensionContext {
  return {
    globalStorageUri: vscode.Uri.file(storagePath),
  } as vscode.ExtensionContext;
}

async function withCatalogEnvironment(
  options: {
    fetchText?: string | Error;
    fetchDelayMs?: number;
    diskText?: string | null;
    diskMtimeAgeMs?: number | null;
  },
  run: (state: {
    readonly fetchCalls: number;
    readonly storagePath: string;
    readonly context: vscode.ExtensionContext;
  }) => Promise<void>,
): Promise<void> {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "model-catalog-"));
  const cachePath = path.join(storagePath, CACHE_FILE);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  if (options.diskText !== null && options.diskText !== undefined) {
    await fs.mkdir(storagePath, { recursive: true });
    await fs.writeFile(cachePath, options.diskText, "utf8");

    if (options.diskMtimeAgeMs !== null && options.diskMtimeAgeMs !== undefined) {
      const mtime = new Date(Date.now() - options.diskMtimeAgeMs);
      await fs.utimes(cachePath, mtime, mtime);
    }
  }

  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (options.fetchText instanceof Error) {
      throw options.fetchText;
    }
    if (options.fetchDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.fetchDelayMs));
    }
    return {
      ok: true,
      text: async () => options.fetchText ?? JSON.stringify(REMOTE_FIXTURE),
      status: 200,
    } as Response;
  };

  try {
    await run({
      get fetchCalls() {
        return fetchCalls;
      },
      storagePath,
      context: createContext(storagePath),
    });
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(storagePath, { recursive: true, force: true });
  }
}

async function idsFor(
  company: Company,
  options: Parameters<typeof withCatalogEnvironment>[0],
): Promise<string[]> {
  let ids: string[] = [];
  await withCatalogEnvironment(options, async ({ context }) => {
    ids = (await getModelsByCompany(context, company)).map((model: ModelInfo) => model.id);
  });
  return ids;
}

suite("model-catalog", () => {
  test("owner-filtered companies only return matching owned_by models", async () => {
    const ids = await idsFor("anthropic", {
      diskText: JSON.stringify(DISK_FIXTURE),
      diskMtimeAgeMs: 10,
    });

    assert.deepStrictEqual(ids.sort(), ["claude-opus-4-5", "no-display"]);
  });

  test("owner-filtered companies exclude models without owned_by", async () => {
    const ids = await idsFor("openai", {
      diskText: JSON.stringify(DISK_FIXTURE),
      diskMtimeAgeMs: 10,
    });

    assert.deepStrictEqual(ids, ["gpt-5"]);
  });

  test("aggregators return every model including ownerless entries", async () => {
    const ids = await idsFor("openrouter", {
      diskText: JSON.stringify(DISK_FIXTURE),
      diskMtimeAgeMs: 10,
    });

    assert.deepStrictEqual(ids.sort(), ["claude-opus-4-5", "flux-pro", "gpt-5", "no-display"]);
  });

  test("displayName falls back to id and defaults ownedBy/aliases", async () => {
    let model: ModelInfo | undefined;

    await withCatalogEnvironment(
      {
        diskText: JSON.stringify(DISK_FIXTURE),
        diskMtimeAgeMs: 10,
      },
      async ({ context }) => {
        model = (await getModelsByCompany(context, "nvidia")).find(
          (entry: ModelInfo) => entry.id === "flux-pro",
        );
      },
    );

    assert.ok(model);
    assert.strictEqual(model.displayName, "flux-pro");
    assert.strictEqual(model.ownedBy, "");
    assert.deepStrictEqual(model.aliases, []);
  });

  test("malformed fetched JSON falls back without throwing", async () => {
    const ids = await idsFor("anthropic", {
      fetchText: JSON.stringify({ nope: 1 }),
      diskText: null,
      diskMtimeAgeMs: null,
    });

    assert.ok(ids.length > 0);
  });

  test("fresh disk cache is used before fetch", async () => {
    await withCatalogEnvironment(
      {
        diskText: JSON.stringify(DISK_FIXTURE),
        diskMtimeAgeMs: 10,
      },
      async (state) => {
        const ids = await getModelsByCompany(state.context, "anthropic");
        assert.deepStrictEqual(
          ids.map((model: ModelInfo) => model.id).sort(),
          ["claude-opus-4-5", "no-display"],
        );
        assert.strictEqual(state.fetchCalls, 0);
      },
    );
  });

  test("parallel calls share one in-flight fetch", async () => {
    await withCatalogEnvironment(
      {
        fetchDelayMs: 10,
        diskText: null,
        diskMtimeAgeMs: null,
      },
      async (state) => {
        const [a, b] = await Promise.all([
          getModelsByCompany(state.context, "anthropic"),
          getModelsByCompany(state.context, "anthropic"),
        ]);

        assert.strictEqual(state.fetchCalls, 1);
        assert.deepStrictEqual(
          a.map((model: ModelInfo) => model.id),
          ["live-model"],
        );
        assert.deepStrictEqual(
          b.map((model: ModelInfo) => model.id),
          ["live-model"],
        );
      },
    );
  });

  test("successful fetch writes the disk cache", async () => {
    await withCatalogEnvironment(
      {
        diskText: null,
        diskMtimeAgeMs: null,
      },
      async (state) => {
        const ids = await getModelsByCompany(state.context, "anthropic");
        assert.deepStrictEqual(
          ids.map((model: ModelInfo) => model.id),
          ["live-model"],
        );
        assert.strictEqual(
          await fs.readFile(path.join(state.storagePath, CACHE_FILE), "utf8"),
          JSON.stringify(REMOTE_FIXTURE),
        );
      },
    );
  });
});
