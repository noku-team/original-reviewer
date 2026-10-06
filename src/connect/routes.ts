import type { Hono } from "hono";
import { saveCredential } from "./store.ts";

export type ConnectOpts = { fetch?: typeof fetch | undefined };

function selfHost(): boolean {
  return Boolean(process.env.ORIGINAL_API_KEY);
}

export function mountConnect(app: Hono, opts: ConnectOpts = {}): void {
  const doFetch = opts.fetch ?? fetch;

  app.get("/", (c) => c.text(
    [
      "Original Reviewer",
      "",
      "Install the GitHub App on a repository, then connect an Original account.",
      "Self-host: set ORIGINAL_API_KEY and skip /connect.",
      "Hosted: visit /connect/original?installation_id=<id>",
    ].join("\n"),
  ));

  app.get("/connect/original", (c) => {
    if (selfHost()) return c.body("not found", 404);
    const authorize = process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
    if (!authorize) return c.body("connect is not configured", 501);
    const installationId = c.req.query("installation_id") ?? c.req.query("state") ?? "";
    const url = new URL(authorize);
    url.searchParams.set("state", installationId);
    return c.redirect(url.toString(), 302);
  });

  app.get("/connect/callback", async (c) => {
    if (selfHost()) return c.body("not found", 404);
    const tokenUrl = process.env.ORIGINAL_CONNECT_TOKEN_URL;
    if (!tokenUrl) return c.body("connect is not configured", 501);
    const state = c.req.query("state");
    const code = c.req.query("code");
    const installationId = Number(state);
    if (!code || !Number.isInteger(installationId)) return c.body("bad request", 400);
    const response = await doFetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const parsed: unknown = await response.json();
    const token = typeof parsed === "object" && parsed !== null && "access_token" in parsed
      ? (parsed).access_token
      : undefined;
    if (typeof token !== "string") return c.body("token exchange failed", 502);
    saveCredential(installationId, token);
    return c.redirect("/", 302);
  });
}
