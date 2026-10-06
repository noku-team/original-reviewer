export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export type ReviewComment = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
};

export type GitHost = {
  clone(opts: { repo: string; sha: string; dir: string; token: string }): Promise<void>;
  getPull(opts: { repo: string; pr: number }): Promise<{
    sha: string;
    baseSha: string;
    forkRepo?: string | undefined;
    draft: boolean;
    description: string;
  }>;
  createReview(opts: {
    repo: string;
    pr: number;
    commitId: string;
    body: string;
    event: ReviewEvent;
    comments?: ReviewComment[] | undefined;
  }): Promise<{ status: number; body: string }>;
  upsertIssueComment(opts: { repo: string; pr: number; body: string }): Promise<void>;
  setCheckRun(opts: {
    repo: string;
    sha: string;
    status: "queued" | "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | undefined;
    output?: { title: string; summary: string } | undefined;
  }): Promise<void>;
};
