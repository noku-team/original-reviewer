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
  commentStatus?: number | undefined;
}): {
  host: GitHost;
  reviews: Parameters<GitHost["createReview"]>[0][];
  reviewComments: Parameters<GitHost["createReviewComment"]>[0][];
  checks: Parameters<GitHost["setCheckRun"]>[0][];
} {
  const reviews: Parameters<GitHost["createReview"]>[0][] = [];
  const reviewComments: Parameters<GitHost["createReviewComment"]>[0][] = [];
  const checks: Parameters<GitHost["setCheckRun"]>[0][] = [];
  const queue = opts?.reviews ?? [{ status: 200, body: "{}" }];
  const host: GitHost = {
    clone: async () => undefined,
    getPull: async () => ({ sha: "abc", baseSha: "base", draft: false, description: "" }),
    createReview: async (payload) => {
      reviews.push(payload);
      return queue.shift() ?? { status: 200, body: "{}" };
    },
    createReviewComment: async (payload) => {
      reviewComments.push(payload);
      return { status: opts?.commentStatus ?? 200, body: "{}" };
    },
    upsertIssueComment: async () => undefined,
    listIssueComments: async () => [],
    setCheckRun: async (payload) => {
      checks.push(payload);
    },
  };
  return { host, reviews, reviewComments, checks };
}

describe("publishReview", () => {
  it("posts each finding as its own review comment thread", async () => {
    const { host, reviews, reviewComments } = fake();
    await publishReview({
      host,
      repo: "acme/app",
      pr: 1,
      sha: "abc",
      placed: placed(),
      graphPersisted: true,
    });
    expect(reviewComments).toEqual([
      {
        repo: "acme/app",
        pr: 1,
        commitId: "abc",
        path: "src/a.ts",
        line: 4,
        side: "RIGHT",
        body: "_minor_\n\nnit",
      },
    ]);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.comments).toBeUndefined();
  });

  it("skips a finding when GitHub rejects the thread with 422", async () => {
    const { host, reviews, reviewComments } = fake({ commentStatus: 422 });
    await publishReview({
      host,
      repo: "acme/app",
      pr: 1,
      sha: "abc",
      placed: placed(),
      graphPersisted: true,
    });
    expect(reviewComments).toHaveLength(1);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.comments).toBeUndefined();
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
