import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memoryQueue } from "../src/queue.ts";
import { createApp } from "../src/server.ts";

const secret = "whsec";

function sign(payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

const syncPayload = JSON.stringify({
  action: "synchronize",
  installation: { id: 9 },
  repository: { full_name: "acme/app", default_branch: "main" },
  pull_request: {
    number: 3,
    draft: false,
    body: "hello",
    head: { sha: "deadbeef", repo: { full_name: "acme/app" } },
    base: { sha: "cafebabe", repo: { full_name: "acme/app" } },
  },
});

describe("createApp webhooks", () => {
  it("rejects a bad signature without enqueueing", async () => {
    const queue = memoryQueue();
    const app = createApp({ queue, webhookSecret: secret, slug: "original-reviewer" });
    const res = await app.request("/github/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=00",
        "x-github-event": "pull_request",
      },
      body: syncPayload,
    });
    expect(res.status).toBe(401);
    expect(await queue.take()).toBeUndefined();
  });

  it("accepts a signed pull_request.synchronize and enqueues one review", async () => {
    const queue = memoryQueue();
    const app = createApp({ queue, webhookSecret: secret, slug: "original-reviewer" });
    const res = await app.request("/github/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(syncPayload),
        "x-github-event": "pull_request",
      },
      body: syncPayload,
    });
    expect([200, 202]).toContain(res.status);
    const job = await queue.take();
    expect(job).toMatchObject({
      kind: "review",
      repo: "acme/app",
      pr: 3,
      sha: "deadbeef",
    });
    expect(await queue.take()).toBeUndefined();
  });

  it("resolves command review SHAs via resolvePull", async () => {
    const queue = memoryQueue();
    const payload = JSON.stringify({
      action: "created",
      installation: { id: 9 },
      repository: { full_name: "acme/app" },
      issue: { number: 3, pull_request: { url: "https://api.github.com/repos/acme/app/pulls/3" }, body: "" },
      comment: {
        body: "@original-reviewer review",
        user: { login: "alice", type: "User" },
        author_association: "OWNER",
      },
    });
    const app = createApp({
      queue,
      webhookSecret: secret,
      slug: "original-reviewer",
      resolvePull: async () => ({ sha: "abc123", baseSha: "def456" }),
    });
    const res = await app.request("/github/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(payload),
        "x-github-event": "issue_comment",
      },
      body: payload,
    });
    expect(res.status).toBe(202);
    expect(await queue.take()).toMatchObject({
      kind: "review",
      sha: "abc123",
      baseSha: "def456",
      fromCommand: true,
    });
  });

  it("resolves check_run.rerequested SHAs via resolvePull", async () => {
    const queue = memoryQueue();
    const payload = JSON.stringify({
      action: "rerequested",
      installation: { id: 9 },
      repository: { full_name: "acme/app" },
      check_run: {
        name: "original-reviewer",
        head_sha: "deadbeef",
        pull_requests: [{
          number: 3,
          head: { sha: "deadbeef", repo: { full_name: "acme/app" } },
          base: { sha: "stalebase", repo: { full_name: "acme/app" } },
        }],
      },
    });
    const app = createApp({
      queue,
      webhookSecret: secret,
      slug: "original-reviewer",
      resolvePull: async () => ({ sha: "abc123", baseSha: "def456" }),
    });
    const res = await app.request("/github/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(payload),
        "x-github-event": "check_run",
      },
      body: payload,
    });
    expect(res.status).toBe(202);
    expect(await queue.take()).toMatchObject({
      kind: "review",
      sha: "abc123",
      baseSha: "def456",
      fromCommand: true,
      full: true,
    });
  });
});
