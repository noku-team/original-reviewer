import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const GRAPH_REF = "refs/original-reviewer/graph";

function gitError(err: unknown): { code: unknown; stderr: string } {
  if (typeof err === "object" && err !== null) {
    const rec = err as { code?: unknown; stderr?: unknown };
    return { code: rec.code, stderr: String(rec.stderr ?? "") };
  }
  return { code: undefined, stderr: String(err) };
}

export async function fetchGraph(gitDir: string): Promise<{ found: boolean }> {
  try {
    await exec("git", ["-C", gitDir, "fetch", "origin", `${GRAPH_REF}:${GRAPH_REF}`]);
    return { found: true };
  } catch (err) {
    const { code, stderr } = gitError(err);
    if (code === 128 || /not found|couldn't find remote ref/i.test(stderr)) {
      return { found: false };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function pushGraph(gitDir: string, remote: string): Promise<void> {
  await exec("git", ["-C", gitDir, "push", "--force", remote, GRAPH_REF]);
}
