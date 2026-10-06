import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mountConnect } from "./connect/routes.ts";
import { verifyGitHubSignature } from "./github/verify-webhook.ts";
import { parseCommand } from "./review/commands.ts";
import type { Job, JobQueue, ReviewJob } from "./queue.ts";

export type AppDeps = {
  queue: JobQueue;
  webhookSecret: string;
  slug: string;
  runJob?: (job: Job) => Promise<void>;
  fetch?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export function createApp(deps: AppDeps): Hono {
  const paused = new Set<string>();
  const app = new Hono();
  mountConnect(app, { fetch: deps.fetch });

  if (deps.runJob) {
    const run = deps.runJob;
    void (async () => {
      for (;;) {
        const job = await deps.queue.take();
        if (!job) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        await run(job);
      }
    })();
  }

  app.post("/github/webhooks", async (c) => {
    const payload = await c.req.text();
    const ok = verifyGitHubSignature({
      secret: deps.webhookSecret,
      payload,
      signatureHeader: c.req.header("x-hub-signature-256"),
    });
    if (!ok) return c.body("unauthorized", 401);

    const event = c.req.header("x-github-event") ?? "";
    let body: unknown;
    try {
      body = JSON.parse(payload) as unknown;
    } catch {
      return c.body("accepted", 202);
    }
    if (!isRecord(body)) return c.body("accepted", 202);

    try {
      await handleEvent(event, body, deps, paused);
    } catch {
      // still 2xx after a valid signature
    }
    return c.body("accepted", 202);
  });

  return app;
}

export function listen(app: Hono, port = 3000): void {
  serve({ fetch: app.fetch, port });
}

async function handleEvent(
  event: string,
  body: Record<string, unknown>,
  deps: AppDeps,
  paused: Set<string>,
): Promise<void> {
  switch (event) {
    case "installation":
    case "installation_repositories":
      return;
    case "pull_request":
      await enqueuePullRequest(body, deps, paused);
      return;
    case "push":
      await enqueuePush(body, deps);
      return;
    case "issue_comment":
      await handleComment(body, deps, paused);
      return;
    case "check_run":
      await enqueueRerequest(body, deps, paused);
      return;
    default:
      return;
  }
}

function pauseKey(repo: string, pr: number): string {
  return `${repo}#${pr}`;
}

function installationId(body: Record<string, unknown>): number | undefined {
  const inst = isRecord(body.installation) ? num(body.installation.id) : undefined;
  return inst;
}

function repoName(body: Record<string, unknown>): string | undefined {
  return isRecord(body.repository) ? str(body.repository.full_name) : undefined;
}

async function enqueuePullRequest(
  body: Record<string, unknown>,
  deps: AppDeps,
  paused: Set<string>,
): Promise<void> {
  const action = str(body.action);
  if (!action || !REVIEW_ACTIONS.has(action)) return;
  const pr = isRecord(body.pull_request) ? body.pull_request : undefined;
  const repo = repoName(body);
  const inst = installationId(body);
  if (!pr || !repo || inst === undefined) return;
  const number = num(pr.number);
  const head = isRecord(pr.head) ? pr.head : undefined;
  const base = isRecord(pr.base) ? pr.base : undefined;
  const sha = head ? str(head.sha) : undefined;
  const baseSha = base ? str(base.sha) : undefined;
  if (number === undefined || !sha || !baseSha) return;
  const headRepo = head && isRecord(head.repo) ? str(head.repo.full_name) : undefined;
  const defaultBranch =
    (isRecord(body.repository) ? str(body.repository.default_branch) : undefined) ?? "main";
  const job: ReviewJob = {
    kind: "review",
    installationId: inst,
    repo,
    pr: number,
    sha,
    baseSha,
    defaultBranch,
    draft: bool(pr.draft),
    description: str(pr.body) ?? "",
    paused: paused.has(pauseKey(repo, number)),
  };
  if (headRepo && headRepo !== repo) job.forkRepo = headRepo;
  await deps.queue.cancelReview(repo, number, sha);
  await deps.queue.enqueue(job);
}

async function enqueuePush(body: Record<string, unknown>, deps: AppDeps): Promise<void> {
  const repo = isRecord(body.repository) ? body.repository : undefined;
  const defaultBranch = repo ? str(repo.default_branch) : undefined;
  const fullName = repo ? str(repo.full_name) : undefined;
  const ref = str(body.ref);
  const sha = str(body.after);
  const inst = installationId(body);
  if (!defaultBranch || !fullName || !ref || !sha || inst === undefined) return;
  if (ref !== `refs/heads/${defaultBranch}`) return;
  await deps.queue.enqueue({ kind: "index", installationId: inst, repo: fullName, sha });
}

async function handleComment(
  body: Record<string, unknown>,
  deps: AppDeps,
  paused: Set<string>,
): Promise<void> {
  if (str(body.action) !== "created") return;
  const issue = isRecord(body.issue) ? body.issue : undefined;
  if (!issue || !isRecord(issue.pull_request)) return;
  const comment = isRecord(body.comment) ? body.comment : undefined;
  const text = comment ? str(comment.body) : undefined;
  const repo = repoName(body);
  const pr = num(issue.number);
  if (!text || !repo || pr === undefined) return;
  const command = parseCommand(text, deps.slug);
  switch (command.type) {
    case "none":
      return;
    case "help":
      return;
    case "pause":
      paused.add(pauseKey(repo, pr));
      return;
    case "resume":
      paused.delete(pauseKey(repo, pr));
      return;
    case "review": {
      const inst = installationId(body);
      if (inst === undefined) return;
      const job: ReviewJob = {
        kind: "review",
        installationId: inst,
        repo,
        pr,
        sha: str(isRecord(issue.pull_request) ? issue.pull_request.head : undefined) ?? "HEAD",
        baseSha: "unknown",
        defaultBranch: "main",
        fromCommand: true,
        full: command.full,
        paused: false,
        description: str(issue.body) ?? "",
      };
      await deps.queue.cancelReview(repo, pr, job.sha);
      await deps.queue.enqueue(job);
      return;
    }
    default: {
      const _never: never = command;
      return _never;
    }
  }
}

async function enqueueRerequest(
  body: Record<string, unknown>,
  deps: AppDeps,
  paused: Set<string>,
): Promise<void> {
  if (str(body.action) !== "rerequested") return;
  const check = isRecord(body.check_run) ? body.check_run : undefined;
  if (!check || str(check.name) !== "original-reviewer") return;
  const prs = Array.isArray(check.pull_requests) ? check.pull_requests : [];
  const first = prs.find(isRecord);
  const repo = repoName(body);
  const inst = installationId(body);
  const sha = str(check.head_sha);
  const pr = first ? num(first.number) : undefined;
  if (!repo || inst === undefined || !sha || pr === undefined) return;
  void paused;
  const job: ReviewJob = {
    kind: "review",
    installationId: inst,
    repo,
    pr,
    sha,
    baseSha: "unknown",
    defaultBranch: "main",
    fromCommand: true,
    full: true,
  };
  await deps.queue.cancelReview(repo, pr, sha);
  await deps.queue.enqueue(job);
}
