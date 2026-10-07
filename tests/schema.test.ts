import { describe, expect, it } from "vitest";
import { parseReview } from "../src/original/schema.ts";

describe("parseReview", () => {
  it("reads json_schema output with prose around the object", () => {
    const inner = "{\"summary\":\"ok\",\"findings\":[]}Returning structured response: {\"summary\":\"ok\",\"findings\":[]}";
    const envelope = JSON.stringify({
      output: [{ content: [{ type: "output_text", text: inner }] }],
    });
    expect(parseReview(envelope)).toEqual({ summary: "ok", findings: [] });
  });
});
