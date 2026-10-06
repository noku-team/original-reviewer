import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { commitGraph, fetchGraph, GRAPH_REF, pushGraph } from "../src/graph/ref.ts";

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

describe("graph ref", () => {
  it("pushes and fetches graph.json on refs/original-reviewer/graph", async () => {
    const remote = await tmp("or-graph-remote-");
    await exec("git", ["init", "--bare", remote]);

    const work = await tmp("or-graph-work-");
    await exec("git", ["clone", remote, work]);
    await git(work, "config", "user.email", "test@example.com");
    await git(work, "config", "user.name", "test");
    const payload = '{"nodes":[{"id":"Foo"}]}';
    await writeFile(join(work, "graph.json"), payload);
    await git(work, "add", "graph.json");
    await git(work, "commit", "-m", "graph");
    await git(work, "update-ref", GRAPH_REF, "HEAD");
    await pushGraph(work, remote);

    const clone = await tmp("or-graph-clone-");
    await exec("git", ["clone", remote, clone]);
    expect(await fetchGraph(clone)).toEqual({ found: true });
    const shown = await git(clone, "show", `${GRAPH_REF}:graph.json`);
    expect(shown.stdout).toContain(payload);
  });

  it("commits graphify-out onto the graph ref before push", async () => {
    const remote = await tmp("or-graph-commit-remote-");
    await exec("git", ["init", "--bare", remote]);
    const work = await tmp("or-graph-commit-work-");
    await exec("git", ["clone", remote, work]);
    await git(work, "config", "user.email", "test@example.com");
    await git(work, "config", "user.name", "test");
    const out = join(work, "graphify-out");
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "graph.json"), '{"nodes":[{"id":"Zed"}]}');
    await commitGraph(work);
    await pushGraph(work, remote);
    const clone = await tmp("or-graph-commit-clone-");
    await exec("git", ["clone", remote, clone]);
    expect(await fetchGraph(clone)).toEqual({ found: true });
    const shown = await git(clone, "show", `${GRAPH_REF}:graphify-out/graph.json`);
    expect(shown.stdout).toContain("Zed");
    expect(await readFile(join(clone, "graphify-out/graph.json"), "utf8")).toContain("Zed");
  });

  it("returns found false when the remote has no graph ref", async () => {
    const remote = await tmp("or-graph-empty-");
    await exec("git", ["init", "--bare", remote]);
    const work = await tmp("or-graph-empty-work-");
    await exec("git", ["init", work]);
    await git(work, "remote", "add", "origin", remote);
    expect(await fetchGraph(work)).toEqual({ found: false });
  });
});
