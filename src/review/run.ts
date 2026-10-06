import { parseReviewerYaml } from "../config/yaml.ts";
import { assembleContext } from "../graph/assemble.ts";
import { loadEnv } from "../env.ts";
import type { GitHost } from "../host.ts";
import type { OriginalAuth, OriginalClient } from "../original/client.ts";
import { getCredential } from "../connect/store.ts";
import type { Job, JobQueue, ReviewJob } from "../queue.ts";
import { descriptionIgnoresAutoReview } from "./commands.ts";
import { parseMarker } from "./marker.ts";
import { placeFindings } from "./place.ts";
import { publishReview } from "./publish.ts";

export type AuthResult =
  | OriginalAuth
  | { kind: "missing-hosted" }
  | { kind: "missing-selfhost" };

export type RunDeps = {
  host: GitHost;
  queue: JobQueue;
  original: OriginalClient;
  originalAuthFor: (installationId: number) => Promise<AuthResult>;
  skill: string;
  slug: string;
  log: (msg: string) => void;
  readYaml: (job: ReviewJob) => Promise<string | null>;
  getDiff: (job: ReviewJob) => Promise<string>;
  listGuidelines: (job: ReviewJob) => Promise<{ path: string; text: string }[]>;
  listIssueBodies: (job: ReviewJob) => Promise<string[]>;
  fetchGraph: (dir: string) => Promise<{ found: boolean }>;
  pushGraph: (dir: string, remote: string) => Promise<void>;
  runGraphifyUpdate: (dir: string) => Promise<{ ok: boolean; skippedMissing: boolean }>;
};

export async function originalAuthFor(installationId: number): Promise<AuthResult> {
  const key = process.env.ORIGINAL_API_KEY;
  if (key) return { kind: "api-key", key };
  if (process.env.ORIGINAL_CONNECT_AUTHORIZE_URL) {
    const token = getCredential(installationId);
    if (!token) return { kind: "missing-hosted" };
    return { kind: "bearer", token };
  }
  return { kind: "missing-selfhost" };
}

async function failCheck(
  host: GitHost,
  job: ReviewJob,
  conclusion: "success" | "failure" | "neutral",
  summary: string,
): Promise<void> {
  await host.setCheckRun({
    repo: job.repo,
    sha: job.sha,
    status: "completed",
    conclusion,
    output: { title: "original-reviewer", summary },
  });
}

export async function runJob(job: Job, deps: RunDeps): Promise<void> {
  if (job.kind === "index") {
    await deps.host.clone({ repo: job.repo, sha: job.sha, dir: ".", token: "" });
    await deps.fetchGraph(".");
    await deps.runGraphifyUpdate(".");
    try {
      await deps.pushGraph(".", job.repo);
    } catch {
      deps.log("graph push failed");
    }
    return;
  }

  if (!(await deps.queue.isCurrentReview(job.repo, job.pr, job.sha))) return;

  await deps.host.setCheckRun({ repo: job.repo, sha: job.sha, status: "in_progress" });

  let config;
  try {
    config = parseReviewerYaml(await deps.readYaml(job));
  } catch (err) {
    await failCheck(
      deps.host,
      job,
      "failure",
      err instanceof Error ? err.message : "invalid .original-reviewer.yaml",
    );
    return;
  }

  if (job.draft && !config.autoReview.drafts) return;
  if (descriptionIgnoresAutoReview(job.description ?? "", deps.slug) && !job.fromCommand) {
    return;
  }
  if (job.paused && !job.fromCommand) {
    await deps.host.upsertIssueComment({ repo: job.repo, pr: job.pr, body: "paused" });
    return;
  }

  const auth = await deps.originalAuthFor(job.installationId);
  switch (auth.kind) {
    case "missing-hosted":
      await deps.host.upsertIssueComment({
        repo: job.repo,
        pr: job.pr,
        body: "Connect Original to enable reviews.",
      });
      await failCheck(deps.host, job, "neutral", "Original is not connected.");
      return;
    case "missing-selfhost":
      deps.log("Original credential missing");
      await deps.host.upsertIssueComment({
        repo: job.repo,
        pr: job.pr,
        body: "Original is not configured.",
      });
      await failCheck(deps.host, job, "failure", "Original is not configured.");
      return;
    case "api-key":
    case "bearer":
      break;
    default: {
      const _never: never = auth;
      return _never;
    }
  }

  await deps.host.clone({
    repo: job.forkRepo ?? job.repo,
    sha: job.sha,
    dir: ".",
    token: "",
  });
  await deps.fetchGraph(".");
  await deps.runGraphifyUpdate(".");

  const bodies = await deps.listIssueBodies(job);
  const marker = bodies.map(parseMarker).find((m) => m !== undefined);
  const mode = job.full || !marker?.conversationId ? "first" : "follow-up";
  const diff = await deps.getDiff(job);
  const assembled = assembleContext({
    skill: deps.skill,
    diff,
    graphJson: {},
    guidelines: await deps.listGuidelines(job),
    changedSymbols: [],
    budget: loadEnv().messageBudget,
    mode,
    previousFindings: marker?.kept,
  });

  if (!(await deps.queue.isCurrentReview(job.repo, job.pr, job.sha))) return;

  const result = await deps.original.review({
    messages: assembled.messages,
    conversationId: mode === "follow-up" ? marker?.conversationId : undefined,
    auth,
    shrink: () => undefined,
  });
  const placed = placeFindings({
    diff,
    review: result.review,
    requestChangesWorkflow: config.requestChangesWorkflow,
  });
  let graphPersisted = true;
  try {
    await deps.pushGraph(".", job.repo);
  } catch {
    graphPersisted = false;
    deps.log("graph push failed");
  }
  await publishReview({
    host: deps.host,
    repo: job.repo,
    pr: job.pr,
    sha: job.sha,
    placed,
    conversationId: result.conversationId,
    graphPersisted,
  });
}
