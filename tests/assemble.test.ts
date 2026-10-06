import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assembleContext } from "../src/graph/assemble.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const graphJson = JSON.parse(readFileSync(join(fixtures, "graph.json"), "utf8")) as unknown;
const diff = readFileSync(join(fixtures, "diff.txt"), "utf8");

const base = {
  skill: "Review with care.",
  diff,
  graphJson,
  guidelines: [{ path: "AGENTS.md", text: "Be kind." }],
  changedSymbols: ["Foo"],
};

describe("assembleContext", () => {
  it("keeps the full diff and Foo neighbors under the default budget", () => {
    const { messages } = assembleContext({ ...base, budget: 400000, mode: "first" });
    expect(messages[0]).toContain("## Review skill");
    expect(messages[0]).toContain("## Pull request diff");
    expect(messages[0]).toContain(diff);
    expect(messages[0]).toContain("Foo");
    expect(messages[0]?.length).toBeLessThanOrEqual(400000);
  });

  it("never drops the diff when the budget is tight", () => {
    const { messages } = assembleContext({
      ...base,
      budget: diff.length + 80,
      mode: "first",
    });
    expect(messages[0]).toContain(diff);
  });

  it("omits the review skill in follow-up mode", () => {
    const { messages } = assembleContext({
      ...base,
      budget: 400000,
      mode: "follow-up",
      previousFindings: [{ path: "src/foo.ts", line: 2, text: "old" }],
    });
    expect(messages[0]).not.toContain("## Review skill");
    expect(messages[0]).toContain("old");
  });
});
