import { createHash, randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { getCredential, saveCredential, savePkce, takePkce } from "./store.ts";

export type ConnectOpts = { fetch?: typeof fetch | undefined };

function selfHost(): boolean {
  return Boolean(process.env.ORIGINAL_API_KEY);
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function mountConnect(app: Hono, opts: ConnectOpts = {}): void {
  const doFetch = opts.fetch ?? fetch;

  app.get("/", (c) => {
    const connected = c.req.query("connected");
    const installationId = connected ? Number(connected) : Number.NaN;
    if (Number.isInteger(installationId) && getCredential(installationId)) {
      const slug = process.env.GITHUB_APP_SLUG ?? "original-reviewer";
      return c.text(
        [
          "Original Reviewer",
          "",
          `Original is connected for GitHub installation ${installationId}.`,
          "You can close this tab.",
          `Open a pull request, or comment @${slug} review.`,
        ].join("\n"),
      );
    }
    return c.text(
      [
        "Original Reviewer",
        "",
        "Install the GitHub App on a repository, then connect an Original account.",
        "Self-host: set ORIGINAL_API_KEY and skip /connect.",
        "Hosted: visit /connect/original?installation_id=<id>",
      ].join("\n"),
    );
  });

  app.get("/connect/original", (c) => {
    if (selfHost()) return c.body("not found", 404);
    const authorize = process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
    const clientId = process.env.ORIGINAL_CONNECT_CLIENT_ID;
    const redirectUri = process.env.ORIGINAL_CONNECT_REDIRECT_URI;
    if (!authorize || !clientId || !redirectUri) {
      return c.body("connect is not configured", 501);
    }
    const installationId = c.req.query("installation_id") ?? c.req.query("state") ?? "";
    if (!installationId) return c.body("bad request", 400);
    const { verifier, challenge } = pkcePair();
    savePkce(installationId, verifier);
    const url = new URL(authorize);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", process.env.ORIGINAL_CONNECT_SCOPE ?? "openid");
    url.searchParams.set("state", installationId);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return c.redirect(url.toString(), 302);
  });

  app.get("/connect/callback", async (c) => {
    if (selfHost()) return c.body("not found", 404);
    const tokenUrl = process.env.ORIGINAL_CONNECT_TOKEN_URL;
    const clientId = process.env.ORIGINAL_CONNECT_CLIENT_ID;
    const redirectUri = process.env.ORIGINAL_CONNECT_REDIRECT_URI;
    if (!tokenUrl || !clientId || !redirectUri) {
      return c.body("connect is not configured", 501);
    }
    const state = c.req.query("state");
    const code = c.req.query("code");
    const installationId = Number(state);
    if (!code || !state || !Number.isInteger(installationId)) return c.body("bad request", 400);
    const verifier = takePkce(state);
    if (!verifier) return c.body("pkce verifier missing", 400);
    const response = await doFetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    });
    const parsed: unknown = await response.json();
    const token = typeof parsed === "object" && parsed !== null && "access_token" in parsed
      ? (parsed).access_token
      : undefined;
    if (typeof token !== "string") return c.body("token exchange failed", 502);
    saveCredential(installationId, token);
    return c.redirect(`/?connected=${installationId}`, 302);
  });
}
