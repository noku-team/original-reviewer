import { filterDiff, matchingPathInstructions, parseReviewerYaml } from "../config/yaml.ts";
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
  readYaml: (job: ReviewJob, dir: string) => Promise<string | null>;
  getDiff: (job: ReviewJob, dir: string) => Promise<string>;
  listGuidelines: (job: ReviewJob, dir: string) => Promise<{ path: string; text: string }[]>;
  listIssueBodies: (job: ReviewJob) => Promise<string[]>;
  fetchGraph: (dir: string) => Promise<{ found: boolean }>;
  pushGraph: (dir: string, remote: string) => Promise<void>;
  runGraphifyUpdate: (dir: string) => Promise<{ ok: boolean; skippedMissing: boolean }>;
  workspace: () => Promise<string>;
  readGraph: (dir: string) => Promise<unknown>;
  commitGraph: (dir: string) => Promise<void>;
  cleanup?: ((dir: string) => Promise<void>) | undefined;
};

export async function originalAuthFor(installationId: number): Promise<AuthResult> {
  const key = process.env.ORIGINAL_API_KEY;
  if (key) return { kind: "api-key", key };
  if (process.env.ORIGINAL_CONNECT_AUTHORIZE_URL) {
    const token = await getCredential(installationId);
    if (!token) return { kind: "missing-hosted" };
    return { kind: "bearer", token };
  }
  return { kind: "missing-selfhost" };
}

function nodeIds(graphJson: unknown): string[] {
  if (typeof graphJson !== "object" || graphJson === null) return [];
  const { nodes } = (graphJson as { nodes?: unknown });
  if (!Array.isArray(nodes)) return [];
  const ids: string[] = [];
  for (const node of nodes) {
    if (typeof node === "object" && node !== null) {
      const rec = node as { id?: unknown; label?: unknown };
      if (typeof rec.id === "string") ids.push(rec.id);
      else if (typeof rec.label === "string") ids.push(rec.label);
    }
  }
  return ids;
}

export function symbolsFromDiff(diff: string, graphJson: unknown): string[] {
  return nodeIds(graphJson).filter((id) => diff.includes(id));
}

export function publicError(message: string): string {
  return message
    .replace(/x-access-token:[^@\s]+/gi, "x-access-token:***")
    .replace(/\bghs_[A-Za-z0-9]+/g, "ghs_***")
    .replace(/AUTHORIZATION: basic \S+/gi, "AUTHORIZATION: basic ***")
    .replace(/Authorization: bearer \S+/gi, "Authorization: bearer ***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***");
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
    output: { title: "original-reviewer", summary: publicError(summary) },
  });
}

async function persistGraph(
  deps: RunDeps,
  dir: string,
  remote: string,
): Promise<boolean> {
  try {
    await deps.commitGraph(dir);
    await deps.pushGraph(dir, remote);
    return true;
  } catch {
    deps.log("graph push failed");
    return false;
  }
}

export async function runJob(job: Job, deps: RunDeps): Promise<void> {
  if (job.kind === "index") {
    deps.log(`index ${job.repo} ${job.sha.slice(0, 7)}`);
    const dir = await deps.workspace();
    try {
      await deps.host.clone({ repo: job.repo, sha: job.sha, dir, token: "" });
      await deps.fetchGraph(dir);
      await deps.runGraphifyUpdate(dir);
      await persistGraph(deps, dir, job.repo);
    } finally {
      await deps.cleanup?.(dir);
    }
    return;
  }

  if (!(await deps.queue.isCurrentReview(job.repo, job.pr, job.sha))) return;

  deps.log(`review ${job.repo}#${job.pr} ${job.sha.slice(0, 7)}`);
  const dir = await deps.workspace();
  try {
    await deps.host.clone({
      repo: job.repo,
      sha: job.sha,
      dir,
      token: "",
      pr: job.pr,
      ...(job.baseSha && job.baseSha !== "unknown" ? { baseSha: job.baseSha } : {}),
    });
    await deps.fetchGraph(dir);
    await deps.runGraphifyUpdate(dir);

    let config;
    try {
      config = parseReviewerYaml(await deps.readYaml(job, dir));
    } catch (err) {
      await failCheck(
        deps.host,
        job,
        "failure",
        err instanceof Error ? err.message : "invalid .original-reviewer.yaml",
      );
      return;
    }

    if (!config.autoReview.enabled && !job.fromCommand) return;
    if (job.draft && !config.autoReview.drafts) return;
    if (descriptionIgnoresAutoReview(job.description ?? "", deps.slug) && !job.fromCommand) {
      return;
    }
    if (job.paused && !job.fromCommand) {
      await deps.host.upsertIssueComment({ repo: job.repo, pr: job.pr, body: "paused" });
      return;
    }

    await deps.host.setCheckRun({ repo: job.repo, sha: job.sha, status: "in_progress" });

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

    const bodies = await deps.listIssueBodies(job);
    const marker = bodies.map(parseMarker).find((m) => m !== undefined);
    const mode = job.full || !marker?.conversationId ? "first" : "follow-up";
    const diff = filterDiff(await deps.getDiff(job, dir), config);
    if (!diff.trim() && !job.fromCommand) {
      await failCheck(deps.host, job, "success", "nothing to review after path filters");
      return;
    }
    const graphJson = await deps.readGraph(dir);
    const changedPaths = [...diff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)]
      .flatMap((m) => (m[1] ? [m[1]] : []));
    const guidelines = [
      ...await deps.listGuidelines(job, dir),
      ...matchingPathInstructions(config, changedPaths),
    ];
    const assembleInput = {
      skill: deps.skill,
      diff,
      graphJson,
      guidelines,
      changedSymbols: symbolsFromDiff(diff, graphJson),
      budget: loadEnv().messageBudget,
      mode,
      previousFindings: marker?.kept,
    } as const;
    const assembled = assembleContext(assembleInput);

    if (!(await deps.queue.isCurrentReview(job.repo, job.pr, job.sha))) {
      await failCheck(deps.host, job, "neutral", "superseded by a newer SHA");
      return;
    }

    const result = await deps.original.review({
      messages: assembled.messages,
      conversationId: mode === "follow-up" ? marker?.conversationId : undefined,
      auth,
      shrink: () => assembleContext({ ...assembleInput, graphJson: {}, guidelines: [] }).messages,
    });
    const placed = placeFindings({
      diff,
      review: result.review,
      requestChangesWorkflow: config.requestChangesWorkflow,
    });
    const graphPersisted = await persistGraph(deps, dir, job.repo);
    await publishReview({
      host: deps.host,
      repo: job.repo,
      pr: job.pr,
      sha: job.sha,
      placed,
      conversationId: result.conversationId,
      graphPersisted,
    });
  } catch (err) {
    const summary = publicError(err instanceof Error ? err.message : "review failed");
    deps.log(summary);
    const reconnect = summary === "original 401" && process.env.ORIGINAL_CONNECT_AUTHORIZE_URL;
    const origin = process.env.ORIGINAL_CONNECT_REDIRECT_URI
      ? new URL(process.env.ORIGINAL_CONNECT_REDIRECT_URI).origin
      : undefined;
    const connectHref = origin
      ? `${origin}/connect/original?installation_id=${String(job.installationId)}`
      : `/connect/original?installation_id=${String(job.installationId)}`;
    await deps.host.upsertIssueComment({
      repo: job.repo,
      pr: job.pr,
      body: reconnect
        ? `Original rejected the Connect token (401). [Reconnect Original](${connectHref}), then comment \`@${deps.slug} review\`.`
        : `Review failed: ${summary}`,
    });
    await failCheck(deps.host, job, reconnect ? "neutral" : "failure", summary);
  } finally {
    await deps.cleanup?.(dir);
  }
}
