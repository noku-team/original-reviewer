import { describe, expect, it } from "vitest";
import type { Finding } from "../src/original/schema.ts";
import { formatMarker, parseMarker } from "../src/review/marker.ts";

const finding: Finding = {
  severity: "minor",
  path: "src/a.ts",
  line: 4,
  side: "RIGHT",
  text: "nits",
};

describe("marker", () => {
  it("round-trips conversation id, sha, and kept findings", () => {
    const body = formatMarker({
      conversationId: "abc",
      sha: "deadbeef",
      summary: "looks good",
      kept: [finding],
    });
    expect(body.startsWith("<!-- original-review conversation=abc sha=deadbeef -->")).toBe(true);
    expect(parseMarker(body)).toEqual({
      conversationId: "abc",
      sha: "deadbeef",
      kept: [finding],
    });
  });

  it("parses a dana-style prefix with conversation=none", () => {
    const body = "<!-- original-review conversation=none sha=abc123 -->\n\nhello\n";
    expect(parseMarker(body)).toEqual({
      conversationId: undefined,
      sha: "abc123",
      kept: [],
    });
  });

  it("returns undefined when the body is not a marker", () => {
    expect(parseMarker("just a comment")).toBeUndefined();
  });
});
