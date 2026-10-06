import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { connectScope, mountConnect } from "./connect/routes.ts";
import { initCredentialStore, isPaused, setPaused } from "./connect/store.ts";
import { loadEnv } from "./env.ts";
import { commitGraph, fetchGraph, pushGraph } from "./graph/ref.ts";
import { runGraphifyUpdate } from "./graph/run.ts";
import { githubHost, pullDiff } from "./github/host.ts";
import { originalClient } from "./original/client.ts";
import { verifyGitHubSignature } from "./github/verify-webhook.ts";
import { commandAllowed, HELP_TEXT, parseCommand } from "./review/commands.ts";
import { originalAuthFor, runJob } from "./review/run.ts";
import { memoryQueue, redisQueue, type Job, type JobQueue, type ReviewJob } from "./queue.ts";

export type PullRef = { sha: string; baseSha: string; forkRepo?: string | undefined };

export type AppDeps = {
  queue: JobQueue;
  webhookSecret: string;
  slug: string;
  runJob?: ((job: Job) => Promise<void>) | undefined;
  fetch?: typeof fetch | undefined;
  resolvePull?: ((repo: string, pr: number) => Promise<PullRef>) | undefined;
  postComment?: ((repo: string, pr: number, body: string) => Promise<void>) | undefined;
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
  const app = new Hono();
  mountConnect(app, { fetch: deps.fetch });

  if (deps.runJob) {
    const run = deps.runJob;
    void (async () => {
      for (; ;) {
        const job = await deps.queue.take();
        if (!job) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
          });
          continue;
        }
        try {
          await run(job);
        } catch (err) {
          console.error("job failed", err instanceof Error ? err.message : "error");
        }
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
    if (!ok) {
      console.log("webhook rejected: bad signature");
      return c.body("unauthorized", 401);
    }

    const event = c.req.header("x-github-event") ?? "";
    let body: unknown;
    try {
      body = JSON.parse(payload) as unknown;
    } catch {
      console.log(`webhook ${event} invalid json`);
      return c.body("accepted", 202);
    }
    if (!isRecord(body)) return c.body("accepted", 202);

    const action = str(body.action);
    const repo = repoName(body);
    console.log(`webhook ${event}${action ? ` ${action}` : ""}${repo ? ` ${repo}` : ""}`);
    try {
      await handleEvent(event, body, deps);
    } catch (err) {
      console.error("webhook handler failed", err instanceof Error ? err.message : "error");
    }
    return c.body("accepted", 202);
  });

  return app;
}

export function listen(app: Hono, port = 3000): void {
  Bun.serve({ fetch: app.fetch, port });
  console.log(`listening on http://127.0.0.1:${port}`);
}

async function handleEvent(
  event: string,
  body: Record<string, unknown>,
  deps: AppDeps,
): Promise<void> {
  switch (event) {
    case "installation":
    case "installation_repositories":
      return;
    case "pull_request":
      await enqueuePullRequest(body, deps);
      return;
    case "push":
      await enqueuePush(body, deps);
      return;
    case "issue_comment":
      await handleComment(body, deps);
      return;
    case "check_run":
      await enqueueRerequest(body, deps);
      break;
    default:
      break;
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
  const defaultBranch = (isRecord(body.repository) ? str(body.repository.default_branch) : undefined) ?? "main";
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
    paused: await isPaused(pauseKey(repo, number)),
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
): Promise<void> {
  if (str(body.action) !== "created") return;
  const issue = isRecord(body.issue) ? body.issue : undefined;
  if (!issue || !isRecord(issue.pull_request)) return;
  const comment = isRecord(body.comment) ? body.comment : undefined;
  const text = comment ? str(comment.body) : undefined;
  const repo = repoName(body);
  const pr = num(issue.number);
  if (!text || !repo || pr === undefined) return;
  const sender = isRecord(comment?.user) ? comment.user : undefined;
  const issueUser = isRecord(issue.user) ? issue.user : undefined;
  if (!commandAllowed({
    senderLogin: str(sender?.login),
    senderType: str(sender?.type),
    authorAssociation: str(comment?.author_association),
    issueAuthorLogin: str(issueUser?.login),
    slug: deps.slug,
  })) {
    console.log(`comment ignored sender ${str(sender?.login) ?? "?"}`);
    return;
  }
  const command = parseCommand(text, deps.slug);
  console.log(`comment ${command.type} ${repo}#${pr}`);
  switch (command.type) {
    case "none":
      return;
    case "help":
      if (deps.postComment) await deps.postComment(repo, pr, HELP_TEXT);
      return;
    case "pause":
      await setPaused(pauseKey(repo, pr), true);
      if (deps.postComment) await deps.postComment(repo, pr, "paused");
      return;
    case "resume":
      await setPaused(pauseKey(repo, pr), false);
      return;
    case "review": {
      const inst = installationId(body);
      if (inst === undefined || !deps.resolvePull) return;
      const resolved = await deps.resolvePull(repo, pr);
      const job: ReviewJob = {
        kind: "review",
        installationId: inst,
        repo,
        pr,
        sha: resolved.sha,
        baseSha: resolved.baseSha,
        defaultBranch: "main",
        fromCommand: true,
        full: command.full,
        paused: false,
        description: str(issue.body) ?? "",
      };
      if (resolved.forkRepo) job.forkRepo = resolved.forkRepo;
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

function firstCheckPull(
  body: Record<string, unknown>,
  check: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const fromCheck = Array.isArray(check.pull_requests) ? check.pull_requests.find(isRecord) : undefined;
  if (fromCheck) return fromCheck;
  const suite = isRecord(body.check_suite) ? body.check_suite : undefined;
  const fromSuite = suite && Array.isArray(suite.pull_requests)
    ? suite.pull_requests.find(isRecord)
    : undefined;
  return fromSuite;
}

async function enqueueRerequest(
  body: Record<string, unknown>,
  deps: AppDeps,
): Promise<void> {
  if (str(body.action) !== "rerequested") return;
  const check = isRecord(body.check_run) ? body.check_run : undefined;
  if (!check || str(check.name) !== "original-reviewer") return;
  const first = firstCheckPull(body, check);
  const repo = repoName(body);
  const inst = installationId(body);
  const pr = first ? num(first.number) : undefined;
  if (!first || !repo || inst === undefined || pr === undefined) return;

  const payloadFork = isRecord(first.head) && isRecord(first.head.repo)
    ? str(first.head.repo.full_name)
    : undefined;
  const resolved = deps.resolvePull ? await deps.resolvePull(repo, pr) : undefined;
  const sha = resolved?.sha ?? str(check.head_sha);
  const baseSha = resolved?.baseSha ?? (isRecord(first.base) ? str(first.base.sha) : undefined);
  if (!sha || !baseSha) return;

  const job: ReviewJob = {
    kind: "review",
    installationId: inst,
    repo,
    pr,
    sha,
    baseSha,
    defaultBranch: "main",
    fromCommand: true,
    full: true,
  };
  const fork = resolved?.forkRepo ?? (payloadFork && payloadFork !== repo ? payloadFork : undefined);
  if (fork) job.forkRepo = fork;
  await deps.queue.cancelReview(repo, pr, sha);
  await deps.queue.enqueue(job);
}

export async function start(): Promise<void> {
  const env = loadEnv();
  if (!env.webhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET is required");
  const redisUrl = process.env.REDIS_URL;
  const credRedis = await initCredentialStore(redisUrl);
  if (redisUrl && !credRedis) {
    console.error("redis unreachable; using memory queue and credentials");
  }
  const queue = credRedis && redisUrl ? redisQueue(redisUrl) : memoryQueue();
  const host = githubHost();
  const original = originalClient({ baseUrl: env.originalApiBase, botId: env.originalBotId });
  let skill = "";
  try {
    skill = await readFile(new URL("../docs/reviewer/SKILL.md", import.meta.url), "utf8");
  } catch {
    skill = "";
  }
  const app = createApp({
    queue,
    webhookSecret: env.webhookSecret,
    slug: env.githubAppSlug,
    resolvePull: async (repo, pr) => host.getPull({ repo, pr }),
    postComment: async (repo, pr, body) => {
      await host.upsertIssueComment({ repo, pr, body });
    },
    runJob: async (job) => {
      const dir = await mkdtemp(join(tmpdir(), "or-"));
      await runJob(job, {
        host,
        queue,
        original,
        originalAuthFor,
        skill,
        slug: env.githubAppSlug,
        log: (msg) => {
          console.log(msg);
        },
        workspace: () => Promise.resolve(dir),
        cleanup: async (used) => {
          await rm(used, { recursive: true, force: true });
        },
        readYaml: async (_job, used) => {
          try {
            return await readFile(join(used, ".original-reviewer.yaml"), "utf8");
          } catch {
            return null;
          }
        },
        getDiff: async (review, used) => pullDiff(used, review.baseSha, review.sha),
        listGuidelines: async (_job, used) => {
          const names = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", "docs/reviewer/SKILL.md"];
          const out: { path: string; text: string }[] = [];
          for (const name of names) {
            try {
              out.push({ path: name, text: await readFile(join(used, name), "utf8") });
            } catch {
              // missing guideline
            }
          }
          return out;
        },
        listIssueBodies: async (reviewJob) => host.listIssueComments({ repo: reviewJob.repo, pr: reviewJob.pr }),
        fetchGraph,
        pushGraph: async (used, remote) => {
          const url = remote.includes("://") ? remote : `https://github.com/${remote}.git`;
          await pushGraph(used, url);
        },
        runGraphifyUpdate,
        readGraph: async (used) => {
          try {
            return JSON.parse(await readFile(join(used, "graphify-out/graph.json"), "utf8")) as unknown;
          } catch {
            return { nodes: [], links: [] };
          }
        },
        commitGraph,
      });
    },
  });
  const port = Number(process.env.PORT ?? 3000);
  listen(app, port);
  console.log(`queue ${redisUrl ? "redis" : "memory"}`);
  console.log(`credentials ${credRedis ? "redis" : "memory (lost on restart)"}`);
  console.log(process.env.ORIGINAL_API_KEY ? "auth api-key" : `auth connect scope ${connectScope()}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void start();
}
