import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryQueue, type ReviewJob } from "../src/queue.ts";
import type { GitHost } from "../src/host.ts";
import { originalClient } from "../src/original/client.ts";
import { originalAuthFor, runJob, type RunDeps } from "../src/review/run.ts";
import { clearCredentials, saveCredential } from "../src/connect/store.ts";

function job(over: Partial<ReviewJob> = {}): ReviewJob {
  return {
    kind: "review",
    installationId: 1,
    repo: "acme/app",
    pr: 1,
    sha: "bbb",
    baseSha: "base",
    defaultBranch: "main",
    ...over,
  };
}

function reviewDoc(): string {
  return JSON.stringify({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ summary: "ok", findings: [] }) }],
      },
    ],
  });
}

type AuthKind = Awaited<ReturnType<typeof originalAuthFor>>;

function harness(over: Partial<RunDeps> & { authKind?: AuthKind } = {}) {
  const checks: Parameters<GitHost["setCheckRun"]>[0][] = [];
  const comments: string[] = [];
  const logs: string[] = [];
  const pushRemotes: string[] = [];
  const fetchMock = vi.fn(async () => new Response(reviewDoc(), { status: 200 }));
  const host: GitHost = {
    clone: async () => undefined,
    getPull: async () => ({ sha: "bbb", baseSha: "base", draft: false, description: "" }),
    createReview: async () => ({ status: 200, body: "{}" }),
    upsertIssueComment: async (opts) => {
      comments.push(opts.body);
    },
    setCheckRun: async (opts) => {
      checks.push(opts);
    },
  };
  const queue = memoryQueue();
  const deps: RunDeps = {
    host,
    queue,
    original: originalClient({ baseUrl: "https://api.example", botId: "bot", fetch: fetchMock as unknown as typeof fetch }),
    originalAuthFor: async () => over.authKind ?? { kind: "api-key", key: "k" },
    skill: "skill",
    slug: "original-reviewer",
    log: (msg) => {
      logs.push(msg);
    },
    readYaml: async () => null,
    getDiff: async () => "diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n keep\n+added\n",
    listGuidelines: async () => [],
    listIssueBodies: async () => [],
    fetchGraph: async () => ({ found: false }),
    pushGraph: async (_dir, remote) => {
      pushRemotes.push(remote);
    },
    runGraphifyUpdate: async () => ({ ok: true, skippedMissing: false }),
    workspace: async () => "/tmp/or-job",
    readGraph: async () => ({ nodes: [{ id: "Foo", label: "Foo" }], links: [] }),
    commitGraph: async () => undefined,
    ...over,
  };
  return { deps, fetchMock, checks, comments, logs, pushRemotes, queue };
}

afterEach(() => {
  clearCredentials();
  delete process.env.ORIGINAL_API_KEY;
  delete process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
});

describe("runJob", () => {
  it("does not call Original for a draft when drafts are off", async () => {
    const { deps, fetchMock, checks } = harness();
    await runJob(job({ draft: true }), deps);
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(checks.some((c) => c.status === "in_progress")).toBe(false);
  });

  it("sets a neutral check when hosted Original is missing", async () => {
    const { deps, checks, comments } = harness({ authKind: { kind: "missing-hosted" } });
    await runJob(job(), deps);
    expect(checks.at(-1)?.conclusion).toBe("neutral");
    expect(comments.join("\n")).toMatch(/Connect/i);
  });

  it("pushes the graph to the base repo for a fork PR", async () => {
    const { deps, pushRemotes } = harness();
    await runJob(job({ forkRepo: "alice/app", repo: "acme/app" }), deps);
    expect(pushRemotes).toContain("acme/app");
    expect(pushRemotes).not.toContain("alice/app");
  });

  it("fails self-host without leaking ORIGINAL_API_KEY", async () => {
    const { deps, checks, comments, logs } = harness({ authKind: { kind: "missing-selfhost" } });
    await runJob(job(), deps);
    expect(checks.at(-1)?.conclusion).toBe("failure");
    expect([...comments, ...logs].join("\n")).not.toContain("ORIGINAL_API_KEY");
  });

  it("skips a superseded SHA and reviews only the latest", async () => {
    const { deps, fetchMock, queue } = harness();
    await queue.enqueue(job({ sha: "aaa" }));
    await queue.enqueue(job({ sha: "bbb" }));
    await queue.cancelReview("acme/app", 1, "bbb");
    await runJob(job({ sha: "aaa" }), deps);
    await runJob(job({ sha: "bbb" }), deps);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips auto-review when the description ignores it", async () => {
    const { deps, fetchMock, checks } = harness();
    await runJob(
      job({ description: "@original-reviewer ignore", fromCommand: false }),
      deps,
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(checks.some((c) => c.status === "in_progress")).toBe(false);
  });

  it("fails the check when Original throws", async () => {
    const { deps, checks } = harness({
      original: {
        review: async () => {
          throw new Error("original 500");
        },
      },
    });
    await runJob(job(), deps);
    expect(checks.at(-1)).toMatchObject({ status: "completed", conclusion: "failure" });
  });

  it("includes the graph slice in the Original payload", async () => {
    const messages: string[] = [];
    const { deps } = harness({
      original: {
        review: async (opts) => {
          messages.push(...opts.messages);
          return { review: { summary: "ok", findings: [] } };
        },
      },
      getDiff: async () => "diff --git a/src/foo.ts b/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1,2 @@\n export function Foo() {}\n",
    });
    await runJob(job(), deps);
    expect(messages.join("\n")).toContain("Foo");
    expect(messages.join("\n")).toContain("Graph slice");
  });

  it("clones into a per-job workspace, not cwd", async () => {
    const dirs: string[] = [];
    const { deps } = harness();
    deps.host.clone = async (opts) => {
      dirs.push(opts.dir);
    };
    await runJob(job(), deps);
    expect(dirs[0]).toBeTruthy();
    expect(dirs[0]).not.toBe(".");
  });

  it("shrinks extras after Original 413 and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("too big", { status: 413 }))
      .mockResolvedValueOnce(new Response(reviewDoc(), { status: 200 }));
    const { deps } = harness({
      original: originalClient({
        baseUrl: "https://api.example",
        botId: "bot",
        fetch: fetchMock as unknown as typeof fetch,
      }),
    });
    await runJob(job(), deps);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("originalAuthFor", () => {
  it("returns a stored bearer on hosted and api-key on self-host", async () => {
    process.env.ORIGINAL_API_KEY = "secret";
    expect(await originalAuthFor(1)).toEqual({ kind: "api-key", key: "secret" });
    delete process.env.ORIGINAL_API_KEY;
    process.env.ORIGINAL_CONNECT_AUTHORIZE_URL = "https://connect.example";
    expect(await originalAuthFor(1)).toEqual({ kind: "missing-hosted" });
    saveCredential(1, "tok");
    expect(await originalAuthFor(1)).toEqual({ kind: "bearer", token: "tok" });
  });
});
