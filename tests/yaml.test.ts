import { describe, expect, it } from "vitest";
import { isIgnoredPath, parseReviewerYaml } from "../src/config/yaml.ts";

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
});
