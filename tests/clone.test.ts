import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkoutPull, gitHttpExtraHeader, pullDiff } from "../src/github/host.ts";
import { publicError } from "../src/review/run.ts";

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

  it("fetches a fork SHA from refs/pull/N/head on the base remote", async () => {
    const src = await tmp("or-clone-pr-src-");
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
    await git(src, "update-ref", "refs/pull/7/head", sha);
    await git(src, "checkout", "main");
    await git(src, "branch", "-D", "feature");

    const dest = await tmp("or-clone-pr-dest-");
    await rm(dest, { recursive: true, force: true });
    await checkoutPull({ url: src, dir: dest, sha, baseSha, pr: 7 });
    const diff = await pullDiff(dest, baseSha, sha);
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });
});

describe("git HTTP extraHeader", () => {
  it("encodes GitHub basic auth, not a bearer header", () => {
    const header = gitHttpExtraHeader("ghs_testtoken");
    expect(header.startsWith("AUTHORIZATION: basic ")).toBe(true);
    expect(Buffer.from(header.slice("AUTHORIZATION: basic ".length), "base64").toString()).toBe(
      "x-access-token:ghs_testtoken",
    );
    expect(publicError(`git -c http.extraHeader=${header} clone https://github.com/acme/app.git`)).not.toContain(
      "ghs_testtoken",
    );
    expect(publicError(`git -c http.extraHeader=${header} clone https://github.com/acme/app.git`)).not.toContain(
      Buffer.from("x-access-token:ghs_testtoken").toString("base64"),
    );
  });

  it("sends basic extraHeader so a Basic challenge does not prompt for a username", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      const auth = req.headers.authorization ?? "";
      seen.push(auth);
      if (!auth.toLowerCase().startsWith("basic ")) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="GitHub"' });
        res.end("need basic");
        return;
      }
      res.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement" });
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected tcp address");
    const url = `http://127.0.0.1:${addr.port}/noku-team/ai-dashboard.git`;
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    const token = "ghs_testtoken";
    const fail = async (header: string): Promise<string> => {
      try {
        await exec("git", ["-c", `http.extraHeader=${header}`, "ls-remote", url], { env });
        return "";
      } catch (err) {
        return err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
      }
    };
    try {
      const bearerErr = await fail(`Authorization: bearer ${token}`);
      expect(bearerErr).toMatch(/Authentication failed|could not read Username/i);
      const basicErr = await fail(gitHttpExtraHeader(token));
      expect(basicErr).not.toMatch(/Authentication failed|could not read Username/i);
      expect(seen.some((h) => h.toLowerCase().startsWith("basic "))).toBe(true);
    } finally {
      server.close();
    }
  });
});
