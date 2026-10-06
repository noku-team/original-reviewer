import { App } from "@octokit/app";
import { GRAPH_REF } from "../graph/ref.ts";
import type { GitHost, ReviewComment, ReviewEvent } from "../host.ts";
import { parseMarker } from "../review/marker.ts";

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`invalid repo ${repo}`);
  return { owner, name };
}

async function installationOctokit(repo: string) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
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
  void GRAPH_REF;
  return {
    clone: async () => {
      throw new Error("not implemented");
    },
    createReview: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      const event: ReviewEvent = opts.event;
      const comments: ReviewComment[] | undefined = opts.comments;
      const { status, data } = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
        owner,
        repo: name,
        pull_number: opts.pr,
        commit_id: opts.commitId,
        body: opts.body,
        event,
        comments: comments?.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          body: c.body,
        })),
      });
      return { status, body: JSON.stringify(data) };
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
      const existing = comments.find((c) => parseMarker(c.body ?? "") !== undefined);
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
    setCheckRun: async (opts) => {
      const octokit = await installationOctokit(opts.repo);
      const { owner, name } = splitRepo(opts.repo);
      await octokit.request("POST /repos/{owner}/{repo}/check-runs", {
        owner,
        repo: name,
        name: "original-reviewer",
        head_sha: opts.sha,
        status: opts.status,
        conclusion: opts.conclusion,
        output: opts.output,
      });
    },
  };
}
