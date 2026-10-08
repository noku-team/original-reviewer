import { formatMarker } from "./marker.ts";
import type { GitHost } from "../host.ts";
import type { Placed } from "./place.ts";

export async function publishReview(opts: {
  host: GitHost;
  repo: string;
  pr: number;
  sha: string;
  placed: Placed;
  conversationId?: string | undefined;
  graphPersisted: boolean;
}): Promise<{ check: "success" | "failure" }> {
  for (const comment of opts.placed.comments) {
    const posted = await opts.host.createReviewComment({
      repo: opts.repo,
      pr: opts.pr,
      commitId: opts.sha,
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
    });
    if (posted.status === 422) continue;
  }
  await opts.host.createReview({
    repo: opts.repo,
    pr: opts.pr,
    commitId: opts.sha,
    body: opts.placed.summary,
    event: opts.placed.event,
  });
  await opts.host.upsertIssueComment({
    repo: opts.repo,
    pr: opts.pr,
    body: formatMarker({
      conversationId: opts.conversationId,
      sha: opts.sha,
      summary: opts.placed.summary,
      kept: opts.placed.kept,
    }),
  });
  const check = opts.placed.event === "REQUEST_CHANGES" ? "failure" : "success";
  let { summary } = opts.placed;
  if (!opts.graphPersisted) summary += "\nGraph was not persisted.";
  await opts.host.setCheckRun({
    repo: opts.repo,
    sha: opts.sha,
    status: "completed",
    conclusion: check,
    output: { title: "original-reviewer", summary },
  });
  return { check };
}
