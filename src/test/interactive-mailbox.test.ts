import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Mailbox } from "../adapters/interactive/mailbox";

async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mailbox-test-"));
}

suite("Mailbox", () => {
  test("writeInbox writes the exact turn file under inbox/", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w1");
    await mailbox.ensureDirs();
    await mailbox.writeInbox(1, "do the thing");
    const written = await fs.readFile(path.join(cwd, ".skynet", "w1", "inbox", "turn-1.md"), "utf8");
    assert.strictEqual(written, "do the thing");
  });

  test("tryReadOutbox returns undefined when the file does not exist yet", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w2");
    await mailbox.ensureDirs();
    assert.strictEqual(await mailbox.tryReadOutbox(1), undefined);
  });

  test("tryReadOutbox returns undefined on a half-written file, then the parsed value once valid", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w3");
    await mailbox.ensureDirs();
    const outboxFile = path.join(cwd, ".skynet", "w3", "outbox", "turn-1.json");

    await fs.writeFile(outboxFile, '{"status":"paus');
    assert.strictEqual(await mailbox.tryReadOutbox(1), undefined);

    await fs.writeFile(outboxFile, '{"status":"paused","summary":"ok"}');
    assert.deepStrictEqual(await mailbox.tryReadOutbox(1), { status: "paused", summary: "ok" });
  });

  test("ensureGitignored creates .gitignore, appends, and no-ops when already listed", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w4");

    await mailbox.ensureGitignored(cwd);
    assert.strictEqual(await fs.readFile(path.join(cwd, ".gitignore"), "utf8"), ".skynet/\n");

    await fs.writeFile(path.join(cwd, ".gitignore"), "node_modules/\n");
    await mailbox.ensureGitignored(cwd);
    assert.strictEqual(await fs.readFile(path.join(cwd, ".gitignore"), "utf8"), "node_modules/\n.skynet/\n");

    await mailbox.ensureGitignored(cwd);
    assert.strictEqual(await fs.readFile(path.join(cwd, ".gitignore"), "utf8"), "node_modules/\n.skynet/\n");
  });

  test("dispose removes the worker's mailbox dir", async () => {
    const cwd = await mkTmpRepo();
    const mailbox = new Mailbox(cwd, "w5");
    await mailbox.ensureDirs();
    await mailbox.dispose();
    await assert.rejects(fs.access(mailbox.dir));
  });
});
