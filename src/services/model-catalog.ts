import * as path from "path";
import { existsSync, readFileSync } from "fs";
import * as vscode from "vscode";
import { z } from "zod";

export type Company = "openai" | "anthropic" | "google" | "openrouter" | "nvidia";

export type ModelInfo = {
  id: string;
  displayName: string;
  ownedBy: string;
  aliases: string[];
};

const REMOTE_URL =
  "https://raw.githubusercontent.com/ENTERPILOT/ai-model-list/refs/heads/main/models.json";
const CACHE_FILE = "model-catalog.json";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 500;
const AGGREGATORS = new Set<Company>(["openrouter", "nvidia"]);
const EMPTY_CATALOG: RawCatalog = { models: {} };
const catalogsByContext = new WeakMap<vscode.ExtensionContext, ModelCatalogService>();

const ModelEntrySchema = z
  .object({
    display_name: z.string().optional(),
    owned_by: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  })
  .passthrough();

const CatalogSchema = z
  .object({
    models: z.record(z.string(), ModelEntrySchema),
  })
  .passthrough();

type RawCatalog = z.infer<typeof CatalogSchema>;

type CatalogDeps = {
  ttlMs: number;
  snapshot: RawCatalog;
  fetchText: () => Promise<string>;
  readDiskText: () => Promise<string | null>;
  writeDiskText: (text: string) => Promise<void>;
  diskAgeMs: () => Promise<number | null>;
  logError: (message: string, error: unknown) => void;
};

const SNAPSHOT = loadSnapshot();

export async function getModelsByCompany(
  context: vscode.ExtensionContext,
  company: Company,
): Promise<ModelInfo[]> {
  let service = catalogsByContext.get(context);
  if (!service) {
    service = new ModelCatalogService(createCatalogDeps(context));
    catalogsByContext.set(context, service);
  }

  return service.getModelsByCompany(company);
}

function loadSnapshot(): RawCatalog {
  const snapshotPaths = [
    path.resolve(__dirname, "models.snapshot.json"),
    path.resolve(__dirname, "../src/services/models.snapshot.json"),
    path.resolve(__dirname, "../../src/services/models.snapshot.json"),
  ];

  for (const snapshotPath of snapshotPaths) {
    if (!existsSync(snapshotPath)) {
      continue;
    }

    try {
      return parseSnapshot(JSON.parse(readFileSync(snapshotPath, "utf8")));
    } catch {
      continue;
    }
  }

  return EMPTY_CATALOG;
}

function parseSnapshot(snapshot: unknown): RawCatalog {
  const parsed = CatalogSchema.safeParse(snapshot);
  return parsed.success ? parsed.data : EMPTY_CATALOG;
}

// ponytail: validate only fields we read; widen if we ever surface capabilities/pricing.
function parseCatalog(text: string): RawCatalog | null {
  try {
    const parsed = CatalogSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function selectModels(catalog: RawCatalog, company: Company): ModelInfo[] {
  const includeAll = AGGREGATORS.has(company);
  const models: ModelInfo[] = [];

  for (const [id, entry] of Object.entries(catalog.models)) {
    const ownedBy = entry.owned_by ?? "";
    if (!includeAll && ownedBy !== company) {
      continue;
    }

    models.push({
      id,
      displayName: entry.display_name ?? id,
      ownedBy,
      aliases: [...(entry.aliases ?? [])],
    });
  }

  return models;
}

class ModelCatalogService {
  private memoryCatalog: RawCatalog | null = null;
  private inFlightLoad: Promise<RawCatalog> | null = null;

  constructor(private readonly deps: CatalogDeps) {}

  async getModelsByCompany(company: Company): Promise<ModelInfo[]> {
    try {
      const catalog = await this.getCatalog();
      return selectModels(catalog, company);
    } catch (error) {
      this.deps.logError("ModelCatalog.getModelsByCompany failed", error);
      this.memoryCatalog = this.memoryCatalog ?? this.deps.snapshot;
      return selectModels(this.memoryCatalog, company);
    }
  }

  private async getCatalog(): Promise<RawCatalog> {
    if (this.memoryCatalog) {
      return this.memoryCatalog;
    }

    if (!this.inFlightLoad) {
      this.inFlightLoad = this.loadCatalog().finally(() => {
        this.inFlightLoad = null;
      });
    }

    return this.inFlightLoad;
  }

  private async loadCatalog(): Promise<RawCatalog> {
    const diskAge = await this.safeDiskAgeMs();
    let diskText: string | null = null;

    if (diskAge !== null && diskAge < this.deps.ttlMs) {
      diskText = await this.deps.readDiskText();
      const freshDiskCatalog = this.parseDiskText(diskText, "fresh disk cache");
      if (freshDiskCatalog) {
        this.memoryCatalog = freshDiskCatalog;
        return this.memoryCatalog;
      }
    }

    const fetchedCatalog = await this.fetchCatalog();
    if (fetchedCatalog) {
      this.memoryCatalog = fetchedCatalog;
      return this.memoryCatalog;
    }

    diskText = diskText ?? (await this.deps.readDiskText());
    const staleDiskCatalog = this.parseDiskText(diskText, "stale disk cache");
    if (staleDiskCatalog) {
      this.memoryCatalog = staleDiskCatalog;
      return this.memoryCatalog;
    }

    this.memoryCatalog = this.deps.snapshot;
    return this.memoryCatalog;
  }

  private async fetchCatalog(): Promise<RawCatalog | null> {
    try {
      const text = await this.deps.fetchText();
      const catalog = parseCatalog(text);
      if (!catalog) {
        this.deps.logError("ModelCatalog.fetchCatalog invalid upstream JSON", text.slice(0, 200));
        return null;
      }

      try {
        await this.deps.writeDiskText(text);
      } catch (error) {
        this.deps.logError("ModelCatalog.fetchCatalog failed to write disk cache", error);
      }

      return catalog;
    } catch (error) {
      this.deps.logError("ModelCatalog.fetchCatalog failed", error);
      return null;
    }
  }

  private parseDiskText(text: string | null, source: string): RawCatalog | null {
    if (!text) {
      return null;
    }

    const catalog = parseCatalog(text);
    if (!catalog) {
      this.deps.logError(`ModelCatalog could not parse ${source}`, new Error("invalid catalog shape"));
      return null;
    }

    return catalog;
  }

  private async safeDiskAgeMs(): Promise<number | null> {
    try {
      return await this.deps.diskAgeMs();
    } catch (error) {
      this.deps.logError("ModelCatalog.diskAgeMs failed", error);
      return null;
    }
  }
}

function createCatalogDeps(context: vscode.ExtensionContext): CatalogDeps {
  const cacheUri = vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE);

  return {
    ttlMs: DEFAULT_TTL_MS,
    snapshot: SNAPSHOT,
    fetchText: async () => {
      const response = await fetch(REMOTE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${REMOTE_URL}`);
      }
      return response.text();
    },
    readDiskText: async () => {
      try {
        const data = await vscode.workspace.fs.readFile(cacheUri);
        return Buffer.from(data).toString("utf8");
      } catch {
        return null;
      }
    },
    writeDiskText: async (text: string) => {
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(cacheUri, Buffer.from(text, "utf8"));
    },
    diskAgeMs: async () => {
      try {
        const stat = await vscode.workspace.fs.stat(cacheUri);
        return Date.now() - stat.mtime;
      } catch {
        return null;
      }
    },
    logError: (message: string, error: unknown) => {
      console.error(message, error);
    },
  };
}
