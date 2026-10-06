import { describe, expect, it, vi } from "vitest";
import { originalClient } from "../src/original/client.ts";

function reviewDoc(summary: string): string {
  return JSON.stringify({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({ summary, findings: [] }),
          },
        ],
      },
    ],
  });
}

describe("originalClient", () => {
  it("parses a 200 Open Responses payload and conversation id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { instructions?: unknown };
      expect(body).not.toHaveProperty("instructions");
      expect(String(input)).toBe("https://api.example/api/responses/v1/bot-1");
      expect(init?.headers).toMatchObject({ "x-api-key": "k", "content-type": "application/json" });
      return new Response(reviewDoc("ok"), {
        status: 200,
        headers: { "x-conversation-id": "c1" },
      });
    });
    const client = originalClient({
      baseUrl: "https://api.example",
      botId: "bot-1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.review({
      messages: ["hello"],
      auth: { kind: "api-key", key: "k" },
      shrink: () => undefined,
    });
    expect(result.review.summary).toBe("ok");
    expect(result.conversationId).toBe("c1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shrinks once after 413 and retries", async () => {
    let shrinks = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("too big", { status: 413 }))
      .mockResolvedValueOnce(
        new Response(reviewDoc("shrunk"), {
          status: 200,
          headers: { "x-conversation-id": "c2" },
        }),
      );
    const client = originalClient({
      baseUrl: "https://api.example",
      botId: "bot-1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.review({
      messages: ["huge"],
      auth: { kind: "bearer", token: "t" },
      shrink: () => {
        shrinks += 1;
        return ["small"];
      },
    });
    expect(shrinks).toBe(1);
    expect(result.review.summary).toBe("shrunk");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after three 500s", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    const client = originalClient({
      baseUrl: "https://api.example",
      botId: "bot-1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      client.review({
        messages: ["hello"],
        auth: { kind: "api-key", key: "k" },
        shrink: () => undefined,
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
