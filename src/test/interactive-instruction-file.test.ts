import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapInstructionFile, teardownInstructionFile } from "../adapters/interactive/instruction-file";

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "instruction-file-test-"));
}

suite("instruction file bootstrap/teardown", () => {
  test("bootstrap on a nonexistent file creates it with only the marker block; teardown removes it", async () => {
    const cwd = await mkTmpRepo();
    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w1");
    const created = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
    assert.ok(created.includes("<!-- skynet-interactive:BEGIN -->"));
    assert.ok(created.includes(".skynet/w1/inbox/turn-N.md"));

    await teardownInstructionFile(cwd, "AGENTS.md");
    await assert.rejects(fs.access(path.join(cwd, "AGENTS.md")));
  });

  test("bootstrap appends after real content; teardown restores original content normalized", async () => {
    const cwd = await mkTmpRepo();
    const original = "# Project instructions\n\nAlways run tests before committing.\n";
    await fs.writeFile(path.join(cwd, "AGENTS.md"), original);

    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w2");
    const withBlock = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
    assert.ok(withBlock.startsWith(original.trim()));
    assert.ok(withBlock.includes("<!-- skynet-interactive:BEGIN -->"));

    await teardownInstructionFile(cwd, "AGENTS.md");
    assert.strictEqual(await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8"), `${original.trim()}\n`);
  });

  test("bootstrap is idempotent", async () => {
    const cwd = await mkTmpRepo();
    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w3");
    await bootstrapInstructionFile(cwd, "AGENTS.md", ".skynet/w3");
    const content = await fs.readFile(path.join(cwd, "AGENTS.md"), "utf8");
    assert.strictEqual(content.split("<!-- skynet-interactive:BEGIN -->").length - 1, 1);
  });
});
