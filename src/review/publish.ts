import { formatMarker } from "./marker.ts";
import type { GitHost, ReviewComment } from "../host.ts";
import type { Placed } from "./place.ts";

function dropNamed(body: string, comments: ReviewComment[]): ReviewComment[] {
  const named = comments.filter((c) => body.includes(c.path) && body.includes(String(c.line)));
  if (named.length === 0) return [];
  return comments.filter((c) => !named.some((n) => n.path === c.path && n.line === c.line && n.side === c.side));
}

export async function publishReview(opts: {
  host: GitHost;
  repo: string;
  pr: number;
  sha: string;
  placed: Placed;
  conversationId?: string;
  graphPersisted: boolean;
}): Promise<{ check: "success" | "failure" }> {
  const payload = {
    repo: opts.repo,
    pr: opts.pr,
    commitId: opts.sha,
    body: opts.placed.summary,
    event: opts.placed.event,
  };
  let comments: ReviewComment[] | undefined = opts.placed.comments.length
    ? opts.placed.comments
    : undefined;
  let result = await opts.host.createReview({ ...payload, comments });
  if (result.status === 422) {
    comments = comments ? dropNamed(result.body, comments) : undefined;
    result = await opts.host.createReview({
      ...payload,
      comments: comments && comments.length > 0 ? comments : undefined,
    });
  }
  if (result.status === 422) {
    await opts.host.createReview({ ...payload, comments: undefined });
  }
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
