import { describe, expect, it } from "vitest";
import type { GitHost, ReviewComment } from "../src/host.ts";
import { publishReview } from "../src/review/publish.ts";
import type { Placed } from "../src/review/place.ts";

function placed(over: Partial<Placed> = {}): Placed {
  const comments: ReviewComment[] = [
    { path: "src/a.ts", line: 4, side: "RIGHT", body: "_minor_\n\nnit" },
  ];
  return {
    event: "COMMENT",
    summary: "ok\n\nActionable comments posted: 1",
    comments,
    kept: [
      { severity: "minor", path: "src/a.ts", line: 4, side: "RIGHT", text: "nit" },
    ],
    ...over,
  };
}

function fake(opts?: {
  reviews?: { status: number; body: string }[];
}): {
  host: GitHost;
  reviews: GitHost["createReview"] extends (...a: infer A) => unknown ? A[0][] : never;
  checks: Parameters<GitHost["setCheckRun"]>[0][];
} {
  const reviews: Parameters<GitHost["createReview"]>[0][] = [];
  const checks: Parameters<GitHost["setCheckRun"]>[0][] = [];
  const queue = opts?.reviews ?? [
    { status: 422, body: "Unprocessable" },
    { status: 200, body: "{}" },
  ];
  const host: GitHost = {
    clone: async () => undefined,
    getPull: async () => ({ sha: "abc", baseSha: "base", draft: false, description: "" }),
    createReview: async (payload) => {
      reviews.push(payload);
      return queue.shift() ?? { status: 200, body: "{}" };
    },
    upsertIssueComment: async () => undefined,
    setCheckRun: async (payload) => {
      checks.push(payload);
    },
  };
  return { host, reviews, checks };
}

describe("publishReview", () => {
  it("retries a 422 without comments", async () => {
    const { host, reviews } = fake();
    await publishReview({
      host,
      repo: "acme/app",
      pr: 1,
      sha: "abc",
      placed: placed(),
      graphPersisted: true,
    });
    expect(reviews).toHaveLength(2);
    expect(reviews[1]?.comments === undefined || reviews[1]?.comments?.length === 0).toBe(true);
  });

  it("marks the check success for COMMENT and failure for REQUEST_CHANGES", async () => {
    const comment = fake({ reviews: [{ status: 200, body: "{}" }] });
    const result = await publishReview({
      host: comment.host,
      repo: "acme/app",
      pr: 1,
      sha: "abc",
      placed: placed({ event: "COMMENT" }),
      graphPersisted: true,
    });
    expect(result.check).toBe("success");
    expect(comment.checks.at(-1)?.conclusion).toBe("success");

    const changes = fake({ reviews: [{ status: 200, body: "{}" }] });
    const failed = await publishReview({
      host: changes.host,
      repo: "acme/app",
      pr: 1,
      sha: "abc",
      placed: placed({ event: "REQUEST_CHANGES" }),
      graphPersisted: true,
    });
    expect(failed.check).toBe("failure");
    expect(changes.checks.at(-1)?.conclusion).toBe("failure");
  });

  it("notes when the graph was not persisted", async () => {
    const { host, checks } = fake({ reviews: [{ status: 200, body: "{}" }] });
    await publishReview({
      host,
      repo: "acme/app",
      pr: 1,
      sha: "abc",
      placed: placed(),
      graphPersisted: false,
    });
    expect(checks.at(-1)?.output?.summary).toContain("Graph was not persisted.");
  });
});
