# Original Reviewer — Product Design

> Status: draft for review · Date: 2026-10-06 · Repo: [noku-team/original-reviewer](https://github.com/noku-team/original-reviewer)
>
> Destination: CodeRabbit-class GitHub App, open source, inference on a **public** Original reviewer agent that any [ai.original.land](https://ai.original.land) account can connect.
>
> This spec is the **first slice** (core loop). Later specs cover Security, Change Stack, issue enrichment, finishing-touch agents, GitLab/Bitbucket, and a full settings UI.

Research that this design follows: `dana-dashboard/docs/research/coderabbit-how-it-works.md` (CodeRabbit primary sources + GitHub App + Original Connect addendum).

---

## 1. Goal

A person installs **Original Reviewer** on a GitHub repository, connects an Original account, and gets line-level PR review the way CodeRabbit does: check run, summary, inline findings, `@original-reviewer` commands, incremental follow-up. Context is **repo-aware** via a **persistent graphify AST graph** stored in the repo itself, not a 400KB prompt dump.

Success for this slice:

1. Install the public GitHub App on a repo; connect Original; open a PR; see a check run and inline comments on changed lines.
2. A second push reviews only the new diff, reuses the Original conversation, and does not rebuild the whole graph.
3. The same binary self-hosts with App credentials + `ORIGINAL_API_KEY`.
4. No LLM is used to build or update the code graph.

Non-goals for this slice: poem, walkthrough fortune, 50+ linter catalog, org-wide learnings, Security product, Change Stack UI, IDE/CLI, GitLab/Bitbucket.

---

## 2. Who it is for

- Teams that already have (or will get) an Original account and want CodeRabbit-shaped review without sending code to CodeRabbit’s SaaS index.
- noku-team as operator of the **hosted** App.
- Operators who run the same process themselves (self-host).

Inference is billed to the connected Original account. The public reviewer bot is shared; credits are not a noku-wide API key.

---

## 3. Architecture

One TypeScript process (HTTP webhook + worker). Graphify runs as a **subprocess** (Python AST extract). Original is called only for the review JSON.

```
GitHub webhook
    → enqueue (return 2xx)
    → worker: clone with installation token
    → graphify update (AST only)
    → assemble slice (graph query + guidelines + diff)
    → POST Original /api/responses/v1/{publicBotId}
    → publish GitHub review + check run
    → push graph to refs/original-reviewer/graph
```

**Hybrid hosting:** noku operates the public App (users install + Original Connect). Self-host runs the same binary with `GITHUB_APP_ID`, private key, webhook secret, `ORIGINAL_API_BASE`, `ORIGINAL_API_KEY`, `ORIGINAL_BOT_ID`. The review engine does not branch on “hosted vs self-host” except auth source.

**GitHub-first.** A git-provider interface exists so GitLab/Bitbucket can attach later without a rewrite. Only GitHub is implemented in this spec.

**Trust:**

- GitHub: installation token (server-to-server). Never the PR author’s token.
- Original hosted: Original Connect (OAuth 2.1 / OIDC / PKCE). Chat/API tokens stay on the worker. No API key in the browser.
- Original self-host: env API key.
- Code is cloned into a per-job workspace and deleted after the job. The only durable derived artifact in the customer git is the graph ref.

---

## 4. Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| Webhook HTTP | Verify `X-Hub-Signature-256`, enqueue, 2xx | App webhook secret |
| Queue + worker | Serialize index/review jobs per repo; cancel superseded review jobs | Queue interface: in-process for dev/self-host; Redis (or compatible) for hosted so jobs survive deploys |
| Cloner | Sparse checkout using path filters; installation token | GitHub contents:read |
| Graphify runner | `graphify update` / first build, AST-only, no `GEMINI_API_KEY` | Python + `graphifyy` |
| Graph store | `refs/original-reviewer/graph` (not a branch) | GitHub contents:write |
| Context assembler | Query subgraph around changed symbols + guideline files + unified diff; enforce byte budget | graph.json + clone |
| Original client | Structured `pr_review` schema, `X-Conversation-Id`, chunk if over budget | Connect token or API key |
| Publisher | Check run `original-reviewer`; review with inline comments; HTML marker comment for conversation id + last SHA + published findings | pull_requests:write, checks:write, issues:write |
| Mini dashboard | GitHub login, install status, Original Connect, disconnect | Hosted only; self-host skips (env) |

No object storage. GitHub Apps have no blob API.

---

## 5. Persistent graph (graphify AST, no LLM)

Graphify on **code** is structural (tree-sitter / AST). Incremental `graphify update` with only code changes skips semantic extraction. Markdown guidelines are **not** fed to graphify semantic: they are concatenated as text.

**Store:** custom ref `refs/original-reviewer/graph`. Hidden from the branch list and from a default clone. Tree contains `graph.json` and the graphify manifest needed for `--update`.

**Index job** (`push` to the default branch, and after a review that changed files): fetch ref (404 → empty graph) → AST update → commit on that ref → force-push.

**Review job:** fetch ref → apply diff files incrementally → query → call Original → publish → persist updated graph on the ref.

If the graph push fails, the review still publishes. The check notes that the graph was not persisted. The next review rebuilds from whatever ref exists.

**Fork PRs:** clone the fork head; the graph ref lives on the **base** repo (where the App is installed). In-memory update during review; persist to the base ref. Never push to the fork.

Dana-dashboard’s current graph is ~400KB / 418 nodes. That size is the expected order of magnitude for small/medium repos. Path filters must exclude lockfiles, `dist/`, `node_modules`, media, generated (CodeRabbit’s default ignore list, copied into `.original-reviewer.yaml` defaults).

---

## 6. Original inference

Public bot id is a deployment config (`ORIGINAL_BOT_ID`), not per-repo. Hosted: after Connect, the worker calls `POST {ORIGINAL_API_BASE}/api/responses/v1/{botId}` with the user’s short-lived credential. Self-host: `x-api-key`.

Request shape matches `dana-dashboard` `.github/scripts/pr-review.sh`: `stream: false`, `json_schema` name `pr_review`, required `summary` + `findings[]` (`severity` minor|blocking, `path`, `line`, `side` LEFT|RIGHT, `text`, optional `suggested_fix`). No `instructions` field.

First message: review skill + pull request diff + graph slice + guideline files. Follow-up: previous published findings + commits since last SHA + new diff; header `X-Conversation-Id`. Conversation id and findings live in an HTML comment on the PR (same pattern as `<!-- original-review -->`), kept after merge.

Byte budget: start at 400KB per Original message (gateway 413 observed around 5.8MB; 382KB succeeded in dana). Diff is never dropped; graph slice and guidelines fill remaining room. One shrink-and-retry on 413.

Suggested fixes use a fenced `diff` in the line comment (not GitHub `suggestion` blocks) unless a later spec flips that. Request-changes workflow default **off**. Check fails only when that flag is on and a blocking finding was published.

---

## 7. GitHub App surface

**Permissions** (this slice):

| Permission | Access | Why |
| --- | --- | --- |
| Contents | write | Clone + push graph ref |
| Pull requests | write | Reviews, inline comments |
| Checks | write | Check run `original-reviewer` |
| Issues | write | Top-level comments, commands |
| Metadata | read | Required |

Workflows, merge queues, Actions: **not** in this slice (no finishing-touch agents, no merge-queue check copy).

**Events:** `pull_request` (opened, synchronize, reopened, ready_for_review), `issue_comment`, `pull_request_review_comment`, `push` (index), `installation` / `installation_repositories`. Skip drafts unless YAML says otherwise.

**Commands** (top-level PR comment, mention `@original-reviewer` or the App’s GitHub handle):

- `review` — incremental
- `full review` — ignore prior bot comments on this PR, re-review the whole diff
- `pause` / `resume`
- `help`

`ignore` in the PR description disables auto-review while present.

**Check run:** queued → in_progress → success / failure / neutral (Original not connected). Re-run from the Checks UI enqueues a full review of HEAD.

---

## 8. Configuration

File `.original-reviewer.yaml` at repo root, read from the **feature branch** under review.

```yaml
language: en-US
reviews:
  request_changes_workflow: false
  auto_review:
    enabled: true
    drafts: false
  path_filters: []          # extra include/exclude; defaults ignore lockfiles/generated/binaries
  path_instructions: []     # { path: glob, instructions: string }
```

Missing file → those defaults. Invalid YAML → check failure, no review.

Guideline files auto-loaded as raw text when present: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.cursor/rules/*`, `docs/reviewer/SKILL.md`. Directory-scoped the same way CodeRabbit scopes guidelines (file applies to its directory tree).

---

## 9. Data flow (review)

1. Webhook verified → job for `(installation, repo, pr, head SHA)`. A newer SHA for the same PR cancels an unfinished review job.
2. Check run in progress.
3. If hosted and Original is not connected → check **neutral** + comment with Connect URL. Stop.
4. Clone HEAD. Fetch graph ref.
5. Graphify AST update on changed files.
6. Assemble: skill + diff + `graphify query` around changed symbols + guideline files, under budget.
7. Original POST. Parse `summary`/`findings` or fail the check (do not dump raw model text on the PR).
8. Drop findings whose `(path, line, side)` is not on `base...head`. Publish one create-review call. On 422, drop the named line, retry once; if still 422, publish body-only.
9. Upsert marker comment (conversation id, SHA, published findings).
10. Push graph ref. Failure here does not fail the review.
11. Check success, or failure when request-changes is on and a blocking finding survived.

Index-only `push` jobs skip Original and the check run.

---

## 10. Error handling

| Failure | Behaviour |
| --- | --- |
| Bad webhook signature | 401, no job |
| Original not connected (hosted) | Neutral check + Connect link |
| Missing API key (self-host) | Failed check, no secret in public comments |
| Clone / GitHub 5xx | Retry 3× backoff, then failed check |
| Graph ref 404 | Full AST build, then persist |
| Graph push rejected | Review still published; check output notes it |
| Original 413 | Shrink slice once (keep full diff); then failed check |
| Original 5xx / timeout | Retry 3×, then failed check |
| Unparseable JSON | Failed check |
| GitHub 422 on lines | Drop + one retry; then body-only review |
| Superseded SHA | Cancel worker; no extra PR comment |
| Command on paused PR | Reply “paused”; explicit `review` still runs |

Logs: HTTP status and byte counts. Never auth bodies.

---

## 11. Testing

Default CI: no GitHub, no Original.

- Webhook signature accept/reject
- Assembler: fixture `graph.json` + diff → slice includes neighbors, stays under budget, always includes the diff
- Parser: valid review JSON; missing `findings` errors
- Placement: on-diff kept, off-diff dropped, 422 retry
- Incremental payload: conversation id present, skill omitted
- Graph ref: temp git repo push/fetch `refs/original-reviewer/graph`

Opt-in local job: real `graphify update` on a fixture tree. Skip in CI if the Python package is missing.

No live smoke against `ai-api.original.land` in CI. First hosted deploy: manual PR on a noku repo.

---

## 12. Implementation shape (this repo)

- TypeScript worker (GitHub App HTTP, Octokit, queue, publisher, Original client).
- Graphify CLI/library as a subprocess for AST extract/update/query.
- Hosted dashboard: smallest possible Connect + install status page (not a CodeRabbit clone).
- Copy review skill from `dana-dashboard/docs/reviewer/SKILL.md` into this repo as the default rubric the public Original bot is instructed to follow. Prompt upload to Original stays an operator step (not in git if it must stay private); the skill file in git is the source of truth for the schema and bar.

`dana-dashboard`’s Actions reviewer can keep running until a repo switches to this App. This spec does not migrate dana-dashboard.

---

## 13. Out of scope (later specs)

Walkthrough sections (sequence diagrams, poem, effort score), `suggestion` fences, 50+ sandbox linters, learnings database, MCP/web search during review, Jira/Linear, multi-repo, Security / Blast Radius, Change Stack, finishing touches (autofix, docstrings, unit tests, fix CI), GitLab/Bitbucket/Azure, IDE/CLI, merge-queue check passthrough, persistent vector embeddings.

---

## 14. Open items that are decided

These were discussed and must not be re-litigated in the plan:

- Hosted + self-host same binary
- GitHub first, provider interface for later
- Core slice only, plus guideline docs + graphify
- Clone in sandbox; Original only sees assembled JSON
- Persistent graphify AST, no LLM on the graph
- Graph in `refs/original-reviewer/graph`, not S3
- Fork PRs persist graph on the base repo
- TypeScript + graphify subprocess (not an all-Python worker)
- Request-changes default off
- Suggested fix = fenced diff, not GitHub suggestion blocks
