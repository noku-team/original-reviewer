import { describe, expect, it } from "vitest";
import { memoryQueue, redisQueue, type ReviewJob } from "../src/queue.ts";

function review(sha: string): ReviewJob {
  return {
    kind: "review",
    installationId: 1,
    repo: "acme/app",
    pr: 1,
    sha,
    baseSha: "base",
    defaultBranch: "main",
  };
}

async function cancelLeavesCurrentSha(queue: ReturnType<typeof memoryQueue>): Promise<void> {
  await queue.enqueue(review("aaa"));
  await queue.enqueue(review("bbb"));
  await queue.cancelReview("acme/app", 1, "bbb");
  expect(await queue.take()).toEqual(review("bbb"));
  expect(await queue.take()).toBeUndefined();
}

describe("memoryQueue", () => {
  it("drops superseded review jobs and yields only the current sha", async () => {
    await cancelLeavesCurrentSha(memoryQueue());
  });
});

describe("redisQueue", () => {
  it.skipIf(!process.env.REDIS_URL)(
    "drops superseded review jobs and yields only the current sha",
    async () => {
      await cancelLeavesCurrentSha(redisQueue(process.env.REDIS_URL!));
    },
  );
});
