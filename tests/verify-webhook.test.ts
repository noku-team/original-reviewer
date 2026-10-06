import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.ts";
import { verifyGitHubSignature } from "../src/github/verify-webhook.ts";

const secret = "s3cret";
const payload = '{"action":"opened"}';

function sha256Header(body: string, key: string): string {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

describe("verifyGitHubSignature", () => {
  it("returns true for a valid sha256 HMAC of the raw body", () => {
    expect(
      verifyGitHubSignature({
        secret,
        payload,
        signatureHeader: sha256Header(payload, secret),
      }),
    ).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    expect(
      verifyGitHubSignature({
        secret,
        payload,
        signatureHeader: sha256Header(payload, "other"),
      }),
    ).toBe(false);
  });

  it("returns false when the header is missing", () => {
    expect(
      verifyGitHubSignature({
        secret,
        payload,
        signatureHeader: undefined,
      }),
    ).toBe(false);
  });
});

describe("loadEnv", () => {
  const keys = [
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_APP_SLUG",
    "ORIGINAL_API_BASE",
    "ORIGINAL_BOT_ID",
  ] as const;
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of keys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  function stash(): void {
    for (const key of keys) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  it("defaults messageBudget to 400000 and githubAppSlug to original-reviewer", () => {
    stash();
    process.env.GITHUB_WEBHOOK_SECRET = "whsec";
    process.env.ORIGINAL_API_BASE = "https://ai-api.example";
    process.env.ORIGINAL_BOT_ID = "bot-1";
    const env = loadEnv();
    expect(env.messageBudget).toBe(400000);
    expect(env.githubAppSlug).toBe("original-reviewer");
    expect(env.webhookSecret).toBe("whsec");
    expect(env.originalApiBase).toBe("https://ai-api.example");
    expect(env.originalBotId).toBe("bot-1");
  });
});
