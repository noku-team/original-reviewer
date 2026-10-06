import { describe, expect, it } from "vitest";
import { descriptionIgnoresAutoReview, parseCommand } from "../src/review/commands.ts";

const slug = "original-reviewer";

describe("parseCommand", () => {
  it("parses full review before review", () => {
    expect(parseCommand("@original-reviewer full review", slug)).toEqual({
      type: "review",
      full: true,
    });
    expect(parseCommand("@original-reviewer review", slug)).toEqual({
      type: "review",
      full: false,
    });
  });

  it("returns none without a mention", () => {
    expect(parseCommand("please review", slug)).toEqual({ type: "none" });
  });

  it("parses pause, resume, and help", () => {
    expect(parseCommand("@original-reviewer pause", slug)).toEqual({ type: "pause" });
    expect(parseCommand("@original-reviewer resume", slug)).toEqual({ type: "resume" });
    expect(parseCommand("@original-reviewer help", slug)).toEqual({ type: "help" });
  });
});

describe("descriptionIgnoresAutoReview", () => {
  it("is true when the description mentions ignore", () => {
    expect(descriptionIgnoresAutoReview("WIP\n@original-reviewer ignore", slug)).toBe(true);
    expect(descriptionIgnoresAutoReview("please review", slug)).toBe(false);
  });
});
