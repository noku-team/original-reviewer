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

export function connectScope(): string {
  const bot = process.env.ORIGINAL_BOT_ID ?? "";
  const explicit = process.env.ORIGINAL_CONNECT_SCOPE;
  const base = !explicit || explicit.trim() === "openid" ? "openid agent.chat:" : explicit.trim();
  // Original authorize 400s on trailing `agent.chat:` with no bot id.
  if (bot && /(^|\s)agent\.chat:$/.test(base)) return `${base}${bot}`;
  return base;
}

function tokenScope(token: string): string | undefined {
  const parts = token.split(".");
  const payloadB64 = parts[1];
  if (parts.length !== 3 || !payloadB64) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as { scope?: unknown };
    return typeof payload.scope === "string" ? payload.scope : undefined;
  } catch {
    return undefined;
  }
}

export function mountConnect(app: Hono, opts: ConnectOpts = {}): void {
  const doFetch = opts.fetch ?? fetch;

  app.get("/", async (c) => {
    const connected = c.req.query("connected");
    const installationId = connected ? Number(connected) : Number.NaN;
    if (Number.isInteger(installationId) && await getCredential(installationId)) {
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

  app.get("/connect/original", async (c) => {
    if (selfHost()) return c.body("not found", 404);
    const authorize = process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
    const clientId = process.env.ORIGINAL_CONNECT_CLIENT_ID;
    const redirectUri = process.env.ORIGINAL_CONNECT_REDIRECT_URI;
    if (!authorize || !clientId || !redirectUri) {
      return c.body("connect is not configured", 501);
    }
    const installationRaw = c.req.query("installation_id") ?? "";
    const installationId = Number(installationRaw);
    if (!installationRaw || !Number.isInteger(installationId)) return c.body("bad request", 400);
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString("base64url");
    await savePkce(state, { installationId, verifier });
    const url = new URL(authorize);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    const scope = connectScope();
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
    console.log(`connect authorize scope ${scope}`);
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
    if (!code || !state) return c.body("bad request", 400);
    const pkce = await takePkce(state);
    if (!pkce) return c.body("pkce verifier missing", 400);
    const { installationId, verifier } = pkce;
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
    if (typeof token !== "string") {
      console.error(`connect token exchange ${response.status}`);
      return c.body("token exchange failed", 502);
    }
    const granted = tokenScope(token);
    if (!granted?.includes("agent.chat")) {
      console.error(`connect token missing agent.chat (got ${granted ?? "unknown"}); Original API will 401`);
    }
    await saveCredential(installationId, token);
    console.log(`connect saved installation ${installationId} scope ${granted ?? "unknown"}`);
    return c.redirect(`https://github.com/settings/installations/${installationId}`, 302);
  });
}
