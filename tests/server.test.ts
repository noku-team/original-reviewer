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
});
