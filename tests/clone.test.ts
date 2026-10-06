import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkoutPull, pullDiff } from "../src/github/host.ts";

const exec = promisify(execFile);
const dirs: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<{ stdout: string }> {
  return exec("git", ["-C", cwd, ...args]);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("checkoutPull + pullDiff", () => {
  it("three-dot diffs a branch commit against its base", async () => {
    const src = await tmp("or-clone-src-");
    await exec("git", ["init", "-b", "main", src]);
    await git(src, "config", "user.email", "test@example.com");
    await git(src, "config", "user.name", "test");
    await writeFile(join(src, "f.txt"), "one\n");
    await git(src, "add", "f.txt");
    await git(src, "commit", "-m", "base");
    const baseSha = (await git(src, "rev-parse", "HEAD")).stdout.trim();
    await git(src, "checkout", "-b", "feature");
    await writeFile(join(src, "f.txt"), "two\n");
    await git(src, "add", "f.txt");
    await git(src, "commit", "-m", "head");
    const sha = (await git(src, "rev-parse", "HEAD")).stdout.trim();
    await git(src, "checkout", "main");

    const dest = await tmp("or-clone-dest-");
    await rm(dest, { recursive: true, force: true });
    await checkoutPull({ url: src, dir: dest, sha, baseSha });
    const diff = await pullDiff(dest, baseSha, sha);
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });
});
