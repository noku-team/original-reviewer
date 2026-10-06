import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCredentials, getCredential } from "../src/connect/store.ts";
import { memoryQueue } from "../src/queue.ts";
import { createApp } from "../src/server.ts";

afterEach(() => {
  clearCredentials();
  delete process.env.ORIGINAL_API_KEY;
  delete process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
  delete process.env.ORIGINAL_CONNECT_TOKEN_URL;
});

describe("connect routes", () => {
  it("returns 404 for connect routes when ORIGINAL_API_KEY is set", async () => {
    process.env.ORIGINAL_API_KEY = "self-host";
    const app = createApp({
      queue: memoryQueue(),
      webhookSecret: "s",
      slug: "original-reviewer",
    });
    const res = await app.request("/connect/original");
    expect(res.status).toBe(404);
  });

  it("stores the bearer from the OAuth callback", async () => {
    delete process.env.ORIGINAL_API_KEY;
    process.env.ORIGINAL_CONNECT_TOKEN_URL = "https://connect.example/token";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "tok-1" }), { status: 200 }));
    const app = createApp({
      queue: memoryQueue(),
      webhookSecret: "s",
      slug: "original-reviewer",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const res = await app.request("/connect/callback?state=1&code=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(getCredential(1)).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
