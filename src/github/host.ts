import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { App } from "@octokit/app";
import type { GitHost } from "../host.ts";
import { parseMarker } from "../review/marker.ts";

const exec = promisify(execFile);

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

export function gitHttpExtraHeader(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `AUTHORIZATION: basic ${basic}`;
}

export async function checkoutPull(opts: {
  url: string;
  dir: string;
  sha: string;
  baseSha?: string | undefined;
  token?: string | undefined;
  pr?: number | undefined;
}): Promise<void> {
  const header = opts.token ? gitHttpExtraHeader(opts.token) : undefined;
  const auth = header ? ["-c", `http.extraHeader=${header}`] : [];
  await exec("git", [...auth, "clone", "--no-checkout", opts.url, opts.dir], { env: gitEnv });
  if (header) {
    await exec("git", ["-C", opts.dir, "config", "http.extraHeader", header], { env: gitEnv });
  }
  if (opts.pr !== undefined) {
    await exec("git", ["-C", opts.dir, "fetch", "origin", `+refs/pull/${opts.pr}/head:refs/or-job/head`], { env: gitEnv });
  } else {
    await exec("git", ["-C", opts.dir, "fetch", "origin", `+${opts.sha}:refs/or-job/head`], { env: gitEnv });
  }
  if (opts.baseSha && opts.baseSha !== opts.sha) {
    await exec("git", ["-C", opts.dir, "fetch", "origin", `+${opts.baseSha}:refs/or-job/base`], { env: gitEnv });
  }
  await exec("git", ["-C", opts.dir, "checkout", "--force", opts.sha], { env: gitEnv });
}

export async function pullDiff(dir: string, baseSha: string, sha: string): Promise<string> {
  try {
    return (await exec("git", ["-C", dir, "diff", `${baseSha}...${sha}`])).stdout;
  } catch {
    return (await exec("git", ["-C", dir, "diff", baseSha, sha])).stdout;
  }
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`invalid repo ${repo}`);
  return { owner, name };
}

function httpStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) return undefined;
  return typeof err.status === "number" ? err.status : undefined;
}

function httpBody(err: unknown): string {
  if (typeof err !== "object" || err === null || !("message" in err)) return "";
  return typeof err.message === "string" ? err.message : String(err.message);
}

export async function installationToken(repo: string): Promise<string> {
  const octokit = await installationOctokit(repo);
  const authed = await octokit.auth({ type: "installation" }) as { token?: string };
  return authed.token ?? "";
}

async function installationOctokit(repo: string) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY?.replaceAll("\\n", "\n");
  if (!appId || !privateKey) throw new Error("not implemented");
  const app = new App({ appId, privateKey });
  const { owner, name } = splitRepo(repo);
  const { data } = await app.octokit.request("GET /repos/{owner}/{repo}/installation", {
    owner,
    repo: name,
  });
  return app.getInstallationOctokit(data.id);
}

export function githubHost(): GitHost {
  return {
    clone: async (opts) => {
      const token = opts.token || await installationToken(opts.repo);
      await checkoutPull({
        url: `https://github.com/${opts.repo}.git`,
        dir: opts.dir,
        sha: opts.sha,
        ...(opts.baseSha ? { baseSha: opts.baseSha } : {}),
        ...(opts.pr !== undefined ? { pr: opts.pr } : {}),
        ...(token ? { token } : {}),
      });
    },
    getPull: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo: name,
        pull_number: opts.pr,
      });
      const headRepo = data.head.repo.full_name;
      return {
        sha: data.head.sha,
        baseSha: data.base.sha,
        ...(headRepo && headRepo !== opts.repo ? { forkRepo: headRepo } : {}),
        draft: Boolean(data.draft),
        description: data.body ?? "",
      };
    },
    createReview: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      const { event } = opts;
      const { comments } = opts;
      try {
        const { status, data } = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
          owner,
          repo: name,
          pull_number: opts.pr,
          commit_id: opts.commitId,
          body: opts.body,
          event,
          ...(comments === undefined
            ? {}
            : {
              comments: comments.map((c) => ({
                path: c.path,
                line: c.line,
                side: c.side,
                body: c.body,
              })),
            }),
        });
        return { status, body: JSON.stringify(data) };
      } catch (err) {
        if (httpStatus(err) === 422) return { status: 422, body: httpBody(err) };
        throw err;
      }
    },
    upsertIssueComment: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      const { data: comments } = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo: name,
        issue_number: opts.pr,
        per_page: 100,
      });
      const marker = parseMarker(opts.body) !== undefined;
      const existing = marker ? comments.find((c) => parseMarker(c.body ?? "") !== undefined) : undefined;
      if (existing) {
        await octokit.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
          owner,
          repo: name,
          comment_id: existing.id,
          body: opts.body,
        });
        return;
      }
      await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo: name,
        issue_number: opts.pr,
        body: opts.body,
      });
    },
    listIssueComments: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      const { data: comments } = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo: name,
        issue_number: opts.pr,
        per_page: 100,
      });
      return comments.map((c) => c.body ?? "");
    },
    setCheckRun: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      await octokit.request("POST /repos/{owner}/{repo}/check-runs", {
        owner,
        repo: name,
        name: "original-reviewer",
        head_sha: opts.sha,
        status: opts.status,
        ...(opts.conclusion === undefined ? {} : { conclusion: opts.conclusion }),
        ...(opts.output === undefined ? {} : { output: opts.output }),
      });
    },
  };
}
