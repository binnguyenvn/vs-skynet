import * as assert from "assert";
import {
  CatalogDeps,
  ModelCatalog,
  parseCatalog,
  RawCatalog,
  selectModels,
} from "./model-catalog";

const FIXTURE: RawCatalog = {
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

const SNAPSHOT_FIXTURE: RawCatalog = {
  models: {
    "snap-model": {
      display_name: "Snap",
      owned_by: "anthropic",
    },
  },
};

const REMOTE_FIXTURE: RawCatalog = {
  models: {
    "live-model": {
      display_name: "Live",
      owned_by: "anthropic",
    },
  },
};

function fakeDeps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    ttlMs: 1_000,
    snapshot: SNAPSHOT_FIXTURE,
    fetchText: async () => {
      throw new Error("offline");
    },
    readDiskText: async () => null,
    writeDiskText: async () => {},
    diskAgeMs: async () => null,
    logError: () => {},
    ...overrides,
  };
}

suite("model-catalog: pure", () => {
  test("parseCatalog parses a valid catalog", () => {
    const parsed = parseCatalog(JSON.stringify(FIXTURE));
    assert.ok(parsed);
    assert.strictEqual(Object.keys(parsed.models).length, 4);
  });

  test("parseCatalog returns null on malformed JSON", () => {
    assert.strictEqual(parseCatalog("{ not json"), null);
  });

  test("parseCatalog returns null when shape is wrong", () => {
    assert.strictEqual(parseCatalog(JSON.stringify({ nope: 1 })), null);
  });

  test("owner filter returns only matching owned_by", () => {
    const ids = selectModels(FIXTURE, "anthropic")
      .map((model: { id: string }) => model.id)
      .sort();
    assert.deepStrictEqual(ids, ["claude-opus-4-5", "no-display"]);
  });

  test("owner filter excludes models with no owned_by", () => {
    const ids = selectModels(FIXTURE, "openai").map((model: { id: string }) => model.id);
    assert.deepStrictEqual(ids, ["gpt-5"]);
  });

  test("aggregator returns all models incl. no owned_by", () => {
    const ids = selectModels(FIXTURE, "openrouter")
      .map((model: { id: string }) => model.id)
      .sort();
    assert.deepStrictEqual(ids, ["claude-opus-4-5", "flux-pro", "gpt-5", "no-display"]);
  });

  test("displayName falls back to id; ownedBy/aliases default", () => {
    const flux = selectModels(FIXTURE, "nvidia").find(
      (model: { id: string }) => model.id === "flux-pro",
    );
    assert.ok(flux);
    assert.strictEqual(flux.displayName, "flux-pro");
    assert.strictEqual(flux.ownedBy, "");
    assert.deepStrictEqual(flux.aliases, []);
  });
});

suite("model-catalog: loader", () => {
  test("fetch ok + valid returns live data and writes disk", async () => {
    let written: string | null = null;
    const catalog = new ModelCatalog(
      fakeDeps({
        fetchText: async () => JSON.stringify(REMOTE_FIXTURE),
        writeDiskText: async (text: string) => {
          written = text;
        },
      }),
    );

    const ids = (await catalog.getModelsByCompany("anthropic")).map(
      (model: { id: string }) => model.id,
    );

    assert.deepStrictEqual(ids, ["live-model"]);
    assert.notStrictEqual(written, null);
  });

  test("fetch throws + no disk returns snapshot data without throwing", async () => {
    const catalog = new ModelCatalog(fakeDeps());

    const ids = (await catalog.getModelsByCompany("anthropic")).map(
      (model: { id: string }) => model.id,
    );

    assert.deepStrictEqual(ids, ["snap-model"]);
  });

  test("malformed fetched JSON falls back to snapshot data", async () => {
    const catalog = new ModelCatalog(
      fakeDeps({
        fetchText: async () => JSON.stringify({ nope: 1 }),
      }),
    );

    const ids = (await catalog.getModelsByCompany("anthropic")).map(
      (model: { id: string }) => model.id,
    );

    assert.deepStrictEqual(ids, ["snap-model"]);
  });

  test("fresh disk cache is used before fetch", async () => {
    let fetchCalls = 0;
    const diskCatalog: RawCatalog = {
      models: {
        "disk-model": {
          display_name: "Disk",
          owned_by: "anthropic",
        },
      },
    };
    const catalog = new ModelCatalog(
      fakeDeps({
        diskAgeMs: async () => 10,
        readDiskText: async () => JSON.stringify(diskCatalog),
        fetchText: async () => {
          fetchCalls += 1;
          return JSON.stringify(REMOTE_FIXTURE);
        },
      }),
    );

    const ids = (await catalog.getModelsByCompany("anthropic")).map(
      (model: { id: string }) => model.id,
    );

    assert.deepStrictEqual(ids, ["disk-model"]);
    assert.strictEqual(fetchCalls, 0);
  });

  test("parallel first calls share one in-flight fetch", async () => {
    let fetchCalls = 0;
    const catalog = new ModelCatalog(
      fakeDeps({
        fetchText: async () => {
          fetchCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return JSON.stringify(REMOTE_FIXTURE);
        },
      }),
    );

    const [a, b] = await Promise.all([
      catalog.getModelsByCompany("anthropic"),
      catalog.getModelsByCompany("anthropic"),
    ]);

    assert.strictEqual(fetchCalls, 1);
    assert.deepStrictEqual(
      a.map((model: { id: string }) => model.id),
      ["live-model"],
    );
    assert.deepStrictEqual(
      b.map((model: { id: string }) => model.id),
      ["live-model"],
    );
  });
});
