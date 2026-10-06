import { describe, expect, it } from "vitest";
import { filterDiff, isIgnoredPath, parseReviewerYaml } from "../src/config/yaml.ts";

const defaults = {
  language: "en-US",
  requestChangesWorkflow: false,
  autoReview: { enabled: true, drafts: false },
  pathFilters: [],
  pathInstructions: [],
};

describe("parseReviewerYaml", () => {
  it("returns spec defaults for missing yaml", () => {
    expect(parseReviewerYaml(null)).toEqual(defaults);
  });

  it("throws when yaml is invalid", () => {
    expect(() => parseReviewerYaml("not: [")).toThrow(/^invalid \.original-reviewer\.yaml/);
  });
});

describe("isIgnoredPath", () => {
  it("ignores lockfiles by default and keeps source", () => {
    expect(isIgnoredPath("pnpm-lock.yaml", defaults)).toBe(true);
    expect(isIgnoredPath("src/app.ts", defaults)).toBe(false);
  });

  it("drops ignored files from a unified diff", async () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "+++ b/src/a.ts",
      "+kept",
      "diff --git a/package-lock.json b/package-lock.json",
      "+++ b/package-lock.json",
      "+ignored",
    ].join("\n");
    expect(filterDiff(diff, defaults)).toContain("src/a.ts");
    expect(filterDiff(diff, defaults)).not.toContain("package-lock.json");
  });
});
