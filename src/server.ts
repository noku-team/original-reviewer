import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Hono } from "hono";
import { mountConnect } from "./connect/routes.ts";
import { loadEnv } from "./env.ts";
import { commitGraph, fetchGraph, pushGraph } from "./graph/ref.ts";
import { runGraphifyUpdate } from "./graph/run.ts";
import { githubHost } from "./github/host.ts";
import { originalClient } from "./original/client.ts";
import { verifyGitHubSignature } from "./github/verify-webhook.ts";
import { parseCommand } from "./review/commands.ts";
import { originalAuthFor, runJob } from "./review/run.ts";
import { memoryQueue, redisQueue, type Job, type JobQueue, type ReviewJob } from "./queue.ts";

const exec = promisify(execFile);

export type PullRef = { sha: string; baseSha: string; forkRepo?: string | undefined };

export type AppDeps = {
  queue: JobQueue;
  webhookSecret: string;
  slug: string;
  runJob?: ((job: Job) => Promise<void>) | undefined;
  fetch?: typeof fetch | undefined;
  resolvePull?: ((repo: string, pr: number) => Promise<PullRef>) | undefined;
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
        } catch {
          // one bad job must not halt the queue
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
  Bun.serve({ fetch: app.fetch, port });
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

async function enqueueRerequest(
  body: Record<string, unknown>,
  deps: AppDeps,
  _paused: Set<string>,
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

export async function start(): Promise<void> {
  const env = loadEnv();
  const queue = process.env.REDIS_URL ? redisQueue(process.env.REDIS_URL) : memoryQueue();
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
        getDiff: async (review, used) => {
          const { stdout } = await exec("git", ["-C", used, "diff", `${review.baseSha}...${review.sha}`]);
          return stdout;
        },
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
        listIssueBodies: () => Promise.resolve([]),
        fetchGraph,
        pushGraph: async (used, remote) => {
          const url = remote.includes("://")
            ? remote
            : `https://github.com/${remote}.git`;
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
  listen(app, Number(process.env.PORT ?? 3000));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void start();
}
