import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCredentials, getCredential } from "../src/connect/store.ts";
import { memoryQueue } from "../src/queue.ts";
import { createApp } from "../src/server.ts";

afterEach(() => {
  clearCredentials();
  delete process.env.ORIGINAL_API_KEY;
  delete process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
  delete process.env.ORIGINAL_CONNECT_TOKEN_URL;
  delete process.env.ORIGINAL_CONNECT_CLIENT_ID;
  delete process.env.ORIGINAL_CONNECT_REDIRECT_URI;
  delete process.env.ORIGINAL_CONNECT_SCOPE;
});

function hostedEnv(): void {
  delete process.env.ORIGINAL_API_KEY;
  process.env.ORIGINAL_CONNECT_AUTHORIZE_URL = "https://ai.original.land/oauth/authorize";
  process.env.ORIGINAL_CONNECT_TOKEN_URL = "https://ai.original.land/oauth/token";
  process.env.ORIGINAL_CONNECT_CLIENT_ID = "oc_test";
  process.env.ORIGINAL_CONNECT_REDIRECT_URI = "https://reviewer.example/connect/callback";
}

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

  it("redirects to Original authorize with PKCE", async () => {
    hostedEnv();
    const app = createApp({
      queue: memoryQueue(),
      webhookSecret: "s",
      slug: "original-reviewer",
    });
    const res = await app.request("/connect/original?installation_id=168555943");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin + loc.pathname).toBe("https://ai.original.land/oauth/authorize");
    expect(loc.searchParams.get("client_id")).toBe("oc_test");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("state")).toBe("168555943");
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("stores the bearer from the OAuth callback", async () => {
    hostedEnv();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "tok-1" }), { status: 200 }));
    const app = createApp({
      queue: memoryQueue(),
      webhookSecret: "s",
      slug: "original-reviewer",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await app.request("/connect/original?installation_id=1");
    const res = await app.request("/connect/callback?state=1&code=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(getCredential(1)).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledOnce();
    const posted = JSON.stringify(fetchMock.mock.calls);
    expect(posted).toContain("grant_type=authorization_code");
    expect(posted).toContain("code=x");
    expect(posted).toContain("code_verifier=");
  });
});
