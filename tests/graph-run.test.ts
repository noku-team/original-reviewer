import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runGraphifyUpdate } from "../src/graph/run.ts";

const exec = promisify(execFile);
const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "or-graphify-"));
  dirs.push(dir);
  return dir;
}

async function hasGraphify(): Promise<boolean> {
  try {
    await exec("which", ["graphify"]);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runGraphifyUpdate", () => {
  it("skips when graphify is missing, else writes graph.json without setting GEMINI_API_KEY", async () => {
    const dir = await tmp();
    const beforeGemini = process.env.GEMINI_API_KEY;
    if (!(await hasGraphify())) {
      const result = await runGraphifyUpdate(dir);
      expect(result).toEqual({ ok: false, skippedMissing: true });
      expect(process.env.GEMINI_API_KEY).toBe(beforeGemini);
      return;
    }
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/hello.ts"), "export function hello() { return 1; }\n");
    const result = await runGraphifyUpdate(dir);
    expect(result.skippedMissing).toBe(false);
    expect(result.ok).toBe(true);
    const graphRaw = await readFile(join(dir, "graphify-out/graph.json"), "utf8");
    const graph = JSON.parse(graphRaw) as { nodes?: unknown[] };
    expect((graph.nodes ?? []).length).toBeGreaterThanOrEqual(1);
    expect(process.env.GEMINI_API_KEY).toBe(beforeGemini);
  });
});
