import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { HarvestResult, InteractiveCliProfile } from "./types";

export async function harvestSession(
  profile: InteractiveCliProfile,
  configDir: string | undefined
): Promise<HarvestResult> {
  const newest = await newestFileRecursive(profile.sessionDir(configDir));
  if (!newest) {
    return {};
  }
  return profile.harvest(await fs.readFile(newest, "utf8"));
}

async function newestFileRecursive(dir: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let newest: { file: string; mtimeMs: number } | undefined;
  async function consider(file: string): Promise<void> {
    const stat = await fs.stat(file);
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { file, mtimeMs: stat.mtimeMs };
    }
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const candidate = await newestFileRecursive(full);
      if (candidate) {
        await consider(candidate);
      }
    } else if (entry.isFile()) {
      await consider(full);
    }
  }

  return newest?.file;
}
