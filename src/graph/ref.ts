import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const GRAPH_REF = "refs/original-reviewer/graph";

function gitError(err: unknown): { code: unknown; stderr: string } {
  if (typeof err === "object" && err !== null) {
    const rec = err as { code?: unknown; stderr?: unknown };
    return { code: rec.code, stderr: typeof rec.stderr === "string" ? rec.stderr : "" };
  }
  return { code: undefined, stderr: String(err) };
}

export async function fetchGraph(gitDir: string): Promise<{ found: boolean }> {
  try {
    await exec("git", ["-C", gitDir, "fetch", "origin", `${GRAPH_REF}:${GRAPH_REF}`]);
    try {
      await exec("git", ["-C", gitDir, "checkout", GRAPH_REF, "--", "graphify-out"]);
    } catch {
      // older graph commits stored graph.json at the root
    }
    return { found: true };
  } catch (err) {
    const { code, stderr } = gitError(err);
    if (code === 128 || /not found|couldn't find remote ref/i.test(stderr)) {
      return { found: false };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function commitGraph(gitDir: string): Promise<void> {
  const index = join(gitDir, ".git", "tmp-graph-index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const gitIndex = (args: string[]) => exec("git", ["-C", gitDir, ...args], { env });
  try {
    await gitIndex(["read-tree", "--empty"]);
    await gitIndex(["add", "-A", "--", "graphify-out"]);
    const tree = (await gitIndex(["write-tree"])).stdout.trim();
    let parent: string | undefined;
    try {
      parent = (await exec("git", ["-C", gitDir, "rev-parse", GRAPH_REF])).stdout.trim();
    } catch {
      parent = undefined;
    }
    if (parent) {
      const oldTree = (await exec("git", ["-C", gitDir, "rev-parse", `${GRAPH_REF}^{tree}`])).stdout.trim();
      if (oldTree === tree) return;
    }
    const ident = ["-c", "user.email=original-reviewer@localhost", "-c", "user.name=original-reviewer"];
    const commitArgs = parent
      ? [...ident, "commit-tree", tree, "-p", parent, "-m", "original-reviewer graph"]
      : [...ident, "commit-tree", tree, "-m", "original-reviewer graph"];
    const commit = (await exec("git", ["-C", gitDir, ...commitArgs])).stdout.trim();
    await exec("git", ["-C", gitDir, "update-ref", GRAPH_REF, commit]);
  } finally {
    await rm(index, { force: true });
  }
}

export async function pushGraph(gitDir: string, remote: string): Promise<void> {
  await exec("git", ["-C", gitDir, "push", "--force", remote, GRAPH_REF]);
}
