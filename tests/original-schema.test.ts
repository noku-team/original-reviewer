import { describe, expect, it } from "vitest";
import { originalRequestBody, parseReview } from "../src/original/schema.ts";

describe("parseReview", () => {
  it("parses a raw review object", () => {
    expect(parseReview(JSON.stringify({ summary: "ok", findings: [] }))).toEqual({
      summary: "ok",
      findings: [],
    });
  });

  it("throws when findings are missing", () => {
    expect(() => parseReview(JSON.stringify({ summary: "x" }))).toThrow();
  });

  it("reads output_text from an Open Responses document", () => {
    const doc = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                summary: "from doc",
                findings: [
                  {
                    severity: "minor",
                    path: "a.ts",
                    line: 1,
                    side: "RIGHT",
                    text: "nits",
                  },
                ],
              }),
            },
          ],
        },
      ],
    };
    expect(parseReview(JSON.stringify(doc)).summary).toBe("from doc");
  });
});

describe("originalRequestBody", () => {
  it("matches the dana pr_review request shape", () => {
    const body = originalRequestBody("hello") as {
      stream: boolean;
      instructions?: unknown;
      input: { role: string }[];
      text: { format: { name: string; strict: boolean } };
      model?: string;
    };
    expect(body.stream).toBe(false);
    expect(body.input[0]?.role).toBe("user");
    expect(body.text.format.name).toBe("pr_review");
    expect(body.text.format.strict).toBe(true);
    expect(body).not.toHaveProperty("instructions");
    expect(body).not.toHaveProperty("model");
    expect(originalRequestBody("hello", "gpt-x")).toMatchObject({ model: "gpt-x" });
  });
});
