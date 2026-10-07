import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGuidelines } from "../src/review/guidelines.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadGuidelines", () => {
  it("walks .cursor/rules in addition to root guideline files", async () => {
    const root = await mkdtemp(join(tmpdir(), "or-guide-"));
    dirs.push(root);
    await writeFile(join(root, "AGENTS.md"), "be kind");
    await mkdir(join(root, ".cursor", "rules", "src"), { recursive: true });
    await writeFile(join(root, ".cursor", "rules", "src", "api.mdc"), "no n+1");
    const loaded = await loadGuidelines(root);
    expect(loaded).toEqual(expect.arrayContaining([
      { path: "AGENTS.md", text: "be kind" },
      { path: ".cursor/rules/src/api.mdc", text: "no n+1" },
    ]));
  });
});
