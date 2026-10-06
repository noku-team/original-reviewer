# Original Reviewer Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a GitHub App worker that reviews PRs with Original (structured findings + inline comments + check run), using a persistent graphify AST graph on `refs/original-reviewer/graph`.

**Architecture:** One TypeScript HTTP process verifies GitHub webhooks, enqueues jobs, clones with the installation token, updates an AST graph via a graphify subprocess, assembles a bounded context slice, calls the public Original reviewer bot, and publishes a GitHub review. The same binary self-hosts (API key) or runs hosted (Original Connect). GitHub is the only `GitHost` adapter in this plan.

**Tech Stack:** Node 22, TypeScript (strict), Vitest, Hono + `@hono/node-server`, `@octokit/app` + `@octokit/webhooks`, `yaml`, graphify CLI as subprocess (`graphifyy`, no `GEMINI_API_KEY`). Optional `ioredis` only behind the queue interface.

**Spec:** [docs/superpowers/specs/2026-10-06-original-reviewer-design.md](../specs/2026-10-06-original-reviewer-design.md)

## Global Constraints

- TypeScript strict; no `any`; no `@ts-ignore`.
- Default CI never calls GitHub.com or `ai-api.original.land`.
- Graphify runs AST-only: do not set `GEMINI_API_KEY` / `GOOGLE_API_KEY` in worker env.
- Graph lives only at git ref `refs/original-reviewer/graph` (not a branch, not S3).
- Original request: `stream: false`, `json_schema` name `pr_review`, no `instructions` field; findings `severity` is `minor` | `blocking`; `side` is `LEFT` | `RIGHT`.
- Byte budget per Original message: `400000`. Diff is never omitted.
- Suggested fix in comments is a fenced `diff`, not a GitHub `suggestion` block.
- `reviews.request_changes_workflow` defaults to `false`.
- Check run name is `original-reviewer`.
- Bot commands mention `@original-reviewer` or the App slug from env `GITHUB_APP_SLUG` (default `original-reviewer`).
- Marker HTML comment prefix: `<!-- original-review conversation=` (same contract as dana-dashboard).
- Do not migrate `dana-dashboard` Actions; copy `docs/reviewer/SKILL.md` into this repo as the default rubric.
- Function names, types, and file paths in later tasks must match this plan’s Interfaces blocks.

## File map

```
package.json
tsconfig.json
vitest.config.ts
src/server.ts                 # Hono: webhook + dashboard routes
src/env.ts                    # process env
src/host.ts                   # GitHost interface
src/github/host.ts            # GitHub adapter
src/github/verify-webhook.ts
src/queue.ts                  # JobQueue interface + memory + redis
src/config/yaml.ts
src/graph/ref.ts
src/graph/run.ts
src/graph/assemble.ts
src/original/schema.ts
src/original/client.ts
src/review/place.ts
src/review/marker.ts
src/review/commands.ts
src/review/run.ts
src/connect/store.ts          # installation → Original credential (hosted)
src/connect/routes.ts
docs/reviewer/SKILL.md
tests/fixtures/
tests/*.test.ts
```

## Review Focus

- Draft PR when `auto_review.drafts` is false → no Original call, no review (Task 13).
- PR description contains `@original-reviewer ignore` → no auto-review; commands still work (Task 10 + 13).
- Fork PR → `pushGraphRef` target is the base repo full name, never the fork (Task 4 + 13).
- Self-host missing `ORIGINAL_API_KEY` → check `failure`; comment/log must not contain the string `ORIGINAL_API_KEY` or any key value (Task 13).
- Graph slice larger than remaining budget → payload still contains the full diff; guidelines/graph shrink (Task 6 + 11).

---

### Task 1: Webhook signature + app scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/env.ts`, `src/github/verify-webhook.ts`
- Test: `tests/verify-webhook.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `verifyGitHubSignature(opts: { secret: string; payload: string; signatureHeader: string | undefined }): boolean` — true only for valid `sha256=` HMAC of the raw body. `loadEnv(): { webhookSecret: string; githubAppSlug: string; originalApiBase: string; originalBotId: string; messageBudget: number }` with `messageBudget` default `400000`, `githubAppSlug` default `original-reviewer`.

- [ ] **Step 1: Write the failing test**

`tests/verify-webhook.test.ts`: `verifyGitHubSignature` returns true for a known secret/body/`sha256=` hex HMAC, false for a wrong signature, false when the header is missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verify-webhook.test.ts`
Expected: FAIL (`verifyGitHubSignature` not defined)

- [ ] **Step 3: Implement `verifyGitHubSignature` and `loadEnv` in the files above**

Use Node `crypto.createHmac('sha256', secret)`. Timing-safe compare. Scaffold `package.json` scripts `"test": "vitest run"`, `"dev": "tsx src/server.ts"` (server file comes in Task 14; script may point at it now). TypeScript `"strict": true`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verify-webhook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/env.ts src/github/verify-webhook.ts tests/verify-webhook.test.ts
git commit -m "feat: verify GitHub webhook signatures"
```

---

### Task 2: Job queue (memory + Redis)

**Files:**
- Create: `src/queue.ts`
- Test: `tests/queue.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
type ReviewJob = {
  kind: "review";
  installationId: number;
  repo: string;      // owner/name of the repo the App is installed on (base)
  forkRepo?: string; // owner/name to clone when the PR head is a fork
  pr: number;
  sha: string;
  baseSha: string;
  defaultBranch: string;
  fromCommand?: boolean;
  full?: boolean;
};
type IndexJob = {
  kind: "index";
  installationId: number;
  repo: string;
  sha: string;
};
type Job = ReviewJob | IndexJob;
type JobQueue = {
  enqueue(job: Job): Promise<void>;
  take(): Promise<Job | undefined>;
  cancelReview(repo: string, pr: number, exceptSha: string): Promise<number>;
};
function memoryQueue(): JobQueue
function redisQueue(url: string): JobQueue
```

`cancelReview` drops queued review jobs for that `repo`+`pr` whose `sha !== exceptSha`, and sets a cancel flag the worker honors for an in-flight job with a stale sha (store `Set<string>` keyed `repo#pr` → current sha; worker checks before Original POST).

- [ ] **Step 1: Write the failing test**

`tests/queue.test.ts`: enqueue two reviews for `acme/app` PR 1 with sha `aaa` then `bbb`; `cancelReview("acme/app", 1, "bbb")`; `take()` yields only the `bbb` job. Same assertions against `memoryQueue()`; Redis test wraps with `REDIS_URL` and `it.skipIf(!process.env.REDIS_URL)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/queue.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `memoryQueue` and `redisQueue` in `src/queue.ts`**

In-process: array + cancel set. Redis: list + a key `review:{repo}:{pr}:sha` holding the latest sha. Do not add Redis to default CI.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/queue.test.ts`
Expected: PASS (Redis case skipped unless `REDIS_URL` is set)

- [ ] **Step 5: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat: enqueue review jobs and cancel superseded SHAs"
```

---

### Task 3: YAML config and default path filters

**Files:**
- Create: `src/config/yaml.ts`
- Test: `tests/yaml.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
type ReviewerConfig = {
  language: string;
  requestChangesWorkflow: boolean;
  autoReview: { enabled: boolean; drafts: boolean };
  pathFilters: string[];
  pathInstructions: { path: string; instructions: string }[];
};
function parseReviewerYaml(text: string | null): ReviewerConfig
function isIgnoredPath(path: string, config: ReviewerConfig): boolean
```

Missing/`null` text → defaults from spec §8 (`language: "en-US"`, `requestChangesWorkflow: false`, `autoReview.enabled: true`, `autoReview.drafts: false`, empty extra filters). Invalid YAML throws `Error` with message starting `invalid .original-reviewer.yaml`. `isIgnoredPath` is true for spec default ignores (lockfiles, `dist/`, `node_modules`, generated, binaries, media) plus `pathFilters` entries prefixed `!`. A `pathFilters` entry without `!` restricts to include (spec: exclusions win).

- [ ] **Step 1: Write the failing test**

`parseReviewerYaml(null)` equals those defaults. `parseReviewerYaml("not: [")` throws. `isIgnoredPath("pnpm-lock.yaml", defaults)` is true. `isIgnoredPath("src/app.ts", defaults)` is false.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/yaml.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `parseReviewerYaml` and `isIgnoredPath` in `src/config/yaml.ts`**

Copy CodeRabbit default ignore globs that the spec names (lockfiles, `dist/`, `node_modules`, generated, binaries, media). Use `yaml` parse. Minimatch for globs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/yaml.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/yaml.ts tests/yaml.test.ts
git commit -m "feat: parse .original-reviewer.yaml with default ignores"
```

---

### Task 4: Graph git ref store

**Files:**
- Create: `src/graph/ref.ts`
- Test: `tests/graph-ref.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export const GRAPH_REF = "refs/original-reviewer/graph";
function fetchGraph(gitDir: string): Promise<{ found: boolean }>
function pushGraph(gitDir: string, remote: string): Promise<void>
```

`fetchGraph` runs `git fetch origin GRAPH_REF:GRAPH_REF` inside `gitDir`; `found` is false on exit 128 / “not found”. `pushGraph` force-pushes `GRAPH_REF` to `remote`. Tests use a local remote, not GitHub.

- [ ] **Step 1: Write the failing test**

Temp git repo A (bare remote) and clone B. Write `graph.json` in a worktree, commit, `git update-ref GRAPH_REF HEAD`, `pushGraph(B, A)`. New clone C of A: `fetchGraph(C)` → `{ found: true }` and `git show GRAPH_REF:graph.json` contains the payload. Empty remote: `fetchGraph` → `{ found: false }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-ref.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `fetchGraph` and `pushGraph` in `src/graph/ref.ts`**

`child_process` git. No Octokit here; remotes are git URLs (installation-token URL comes from Task 5’s cloner).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph-ref.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/ref.ts tests/graph-ref.test.ts
git commit -m "feat: persist graphify output on refs/original-reviewer/graph"
```

---

### Task 5: `GitHost` + clone stub + graphify runner

**Files:**
- Create: `src/host.ts`, `src/github/host.ts`, `src/graph/run.ts`
- Test: `tests/graph-run.test.ts`

**Interfaces:**
- Consumes: `GRAPH_REF` from Task 4; `isIgnoredPath` from Task 3
- Produces:

```ts
type GitHost = {
  clone(opts: { repo: string; sha: string; dir: string; token: string }): Promise<void>;
  createReview(...): Promise<{ status: number; body: string }>; // filled Task 12
  upsertIssueComment(...): Promise<void>;
  setCheckRun(...): Promise<void>;
};
function runGraphifyUpdate(dir: string): Promise<{ ok: boolean; skippedMissing: boolean }>
```

`runGraphifyUpdate` spawns `graphify` with AST-only update in `dir`. If the binary is missing, return `{ ok: false, skippedMissing: true }` (CI skip). Never passes Gemini keys. `GitHost` methods other than `clone` can throw `Error("not implemented")` until Task 12.

- [ ] **Step 1: Write the failing test**

`tests/graph-run.test.ts`: if `which graphify` fails, assert `runGraphifyUpdate(tmp)` → `skippedMissing: true`. Else, tiny fixture `src/hello.ts` exporting a function; after `runGraphifyUpdate`, `graphify-out/graph.json` exists and has `nodes.length >= 1`. Assert `process.env.GEMINI_API_KEY` is not set by the runner.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/graph-run.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `runGraphifyUpdate` in `src/graph/run.ts` and the `GitHost` type in `src/host.ts`**

Spawn without `GEMINI_API_KEY`/`GOOGLE_API_KEY` in the child env. GitHub `clone` in `src/github/host.ts` can wait until Task 13 if tests use a local dir; still export `githubHost(): GitHost`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/graph-run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/host.ts src/github/host.ts src/graph/run.ts tests/graph-run.test.ts
git commit -m "feat: run graphify AST update without an LLM key"
```

---

### Task 6: Context assembler

**Files:**
- Create: `src/graph/assemble.ts`
- Test: `tests/assemble.test.ts`, `tests/fixtures/graph.json`, `tests/fixtures/diff.txt`

**Interfaces:**
- Consumes: `ReviewerConfig` (Task 3); budget from `loadEnv().messageBudget`
- Produces:

```ts
type AssembleInput = {
  skill: string;
  diff: string;
  graphJson: unknown;
  guidelines: { path: string; text: string }[];
  changedSymbols: string[];
  budget: number;
  mode: "first" | "follow-up";
  previousFindings?: unknown;
};
type AssembleResult = { messages: string[] };
function assembleContext(input: AssembleInput): AssembleResult
```

First mode: message 0 contains `## Review skill`, `## Pull request diff`, and the full `diff`. Graph/guidelines fill remaining bytes. Follow-up mode: no `## Review skill`; includes previous findings. If graph+guidelines do not fit, omit them rather than truncate the diff. Split extra diff only when `diff` itself exceeds `budget` (same rule as dana: continued chunks headed `## Pull request diff (continued)`).

- [ ] **Step 1: Write the failing test**

Fixture graph with nodes `Foo` and `Bar` linked; diff touches `Foo`; `budget: 400000`; first-mode result `messages[0]` includes the entire diff, includes `Foo`, length `<= 400000`. `budget: diff.length + 80` still includes the entire diff and may omit `Bar`. Follow-up mode: `messages[0]` does not contain `## Review skill`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/assemble.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `assembleContext` in `src/graph/assemble.ts`**

Walk `graphJson.nodes` / `links` (NetworkX-style keys from graphify `graph.json`: `nodes`, `links`). Keep neighbors of `changedSymbols` first. Do not call graphify in this function (pure).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/assemble.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/assemble.ts tests/assemble.test.ts tests/fixtures/graph.json tests/fixtures/diff.txt
git commit -m "feat: assemble Original payloads under the byte budget"
```

---

### Task 7: Original schema parse + request body

**Files:**
- Create: `src/original/schema.ts`
- Test: `tests/original-schema.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
type Finding = {
  severity: "minor" | "blocking";
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  text: string;
  suggested_fix?: string;
};
type Review = { summary: string; findings: Finding[] };
function parseReview(outputText: string): Review
function originalRequestBody(message: string, model?: string): unknown
```

`parseReview` accepts either a raw JSON object or an Open Responses document with `output[].content[].output_text`. Throws if `findings` or `summary` missing. `originalRequestBody` matches dana `write_request`: `stream: false`, `input[0].role: "user"`, `text.format.name: "pr_review"`, `strict: true`, no `instructions` key. Include `model` only when `model` is a non-empty string.

- [ ] **Step 1: Write the failing test**

Valid `{summary, findings:[]}` parses. `{summary:"x"}` throws. Body JSON has no `instructions`, has `text.format.name === "pr_review"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/original-schema.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `parseReview` and `originalRequestBody` in `src/original/schema.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/original-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/original/schema.ts tests/original-schema.test.ts
git commit -m "feat: parse Original pr_review JSON schema"
```

---

### Task 8: Place findings on the diff

**Files:**
- Create: `src/review/place.ts`
- Test: `tests/place.test.ts`

**Interfaces:**
- Consumes: `Review`, `Finding` (Task 7)
- Produces:

```ts
type Placed = {
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  summary: string;
  comments: { path: string; line: number; side: "LEFT" | "RIGHT"; body: string }[];
  kept: Finding[];
};
function placeFindings(opts: {
  diff: string;
  review: Review;
  requestChangesWorkflow: boolean;
}): Placed
```

Anchor set: same algorithm as dana `pr-review.sh` (RIGHT for `+` and context, LEFT for `-`). Off-diff findings dropped. Comment body: `_{severity}_\n\n{text}` and if `suggested_fix` then `\n\n\`\`\`diff\n{fix}\n\`\`\``. `event` is `REQUEST_CHANGES` only when `requestChangesWorkflow` is true **and** a kept finding has `severity === "blocking"`; else `COMMENT` (not `APPROVE` — spec default request-changes off means comment-only; when workflow is on and no blockers, `APPROVE`). Summary appends `\n\nActionable comments posted: {n}`.

- [ ] **Step 1: Write the failing test**

Fixture diff with `src/a.ts` adding line 4. Finding on `(src/a.ts, 4, RIGHT)` kept; finding on `(src/a.ts, 99, RIGHT)` dropped. `requestChangesWorkflow: false` + blocking kept → `event === "COMMENT"`. `requestChangesWorkflow: true` + blocking kept → `REQUEST_CHANGES`. `requestChangesWorkflow: true` + only minor → `APPROVE`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/place.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `placeFindings` in `src/review/place.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/place.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/place.ts tests/place.test.ts
git commit -m "feat: drop findings that are not on the pull request diff"
```

---

### Task 9: Marker comment

**Files:**
- Create: `src/review/marker.ts`
- Test: `tests/marker.test.ts`

**Interfaces:**
- Consumes: `Finding` (Task 7)
- Produces:

```ts
function formatMarker(opts: {
  conversationId: string | undefined;
  sha: string;
  summary: string;
  kept: Finding[];
}): string
function parseMarker(body: string): {
  conversationId: string | undefined;
  sha: string | undefined;
  kept: Finding[];
} | undefined
```

First line: `<!-- original-review conversation=${id ?? "none"} sha=${sha} -->`. Then summary. Then `<!-- findings-json` + one JSON line of `kept` + `-->`. `parseMarker` returns undefined if body does not start with `<!-- original-review`.

- [ ] **Step 1: Write the failing test**

Round-trip a conversation id `abc`, sha `deadbeef`, one finding. Parse a dana-style prefix with `conversation=none`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/marker.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `formatMarker` and `parseMarker` in `src/review/marker.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/marker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/marker.ts tests/marker.test.ts
git commit -m "feat: store Original conversation id on the pull request"
```

---

### Task 10: Commands and pause/ignore

**Files:**
- Create: `src/review/commands.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
type Command =
  | { type: "review"; full: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "help" }
  | { type: "none" };
function parseCommand(body: string, slug: string): Command
function descriptionIgnoresAutoReview(description: string, slug: string): boolean
```

`parseCommand` looks for `@${slug}` then `full review` | `review` | `pause` | `resume` | `help` (first match; `full review` before `review`). `descriptionIgnoresAutoReview` is true when the description contains `@${slug} ignore`.

- [ ] **Step 1: Write the failing test**

`@original-reviewer full review` → `{ type: "review", full: true }`. `@original-reviewer review` → `full: false`. Description with `@original-reviewer ignore` → true. Body without mention → `{ type: "none" }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `parseCommand` and `descriptionIgnoresAutoReview` in `src/review/commands.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/commands.ts tests/commands.test.ts
git commit -m "feat: parse @original-reviewer review commands"
```

---

### Task 11: Original HTTP client

**Files:**
- Create: `src/original/client.ts`
- Test: `tests/original-client.test.ts`

**Interfaces:**
- Consumes: `originalRequestBody`, `parseReview` (Task 7); `AssembleResult` (Task 6)
- Produces:

```ts
type OriginalAuth = { kind: "api-key"; key: string } | { kind: "bearer"; token: string };
type OriginalClient = {
  review(opts: {
    messages: string[];
    conversationId?: string;
    auth: OriginalAuth;
    shrink: () => string[] | undefined;
  }): Promise<{ review: Review; conversationId?: string }>;
};
function originalClient(opts: { baseUrl: string; botId: string; fetch?: typeof fetch }): OriginalClient
```

POST `{baseUrl}/api/responses/v1/{botId}` with `content-type: application/json`. `api-key` → header `x-api-key`. `bearer` → `Authorization: Bearer`. If `conversationId` set, header `X-Conversation-Id`. On HTTP 413, call `shrink` once and retry; if shrink returns undefined or 413 again, throw `Error("original 413")`. On 5xx/timeout, retry 3 times then throw. Read `x-conversation-id` response header. Do not log header values or bodies.

- [ ] **Step 1: Write the failing test**

Mock `fetch`: 200 Open Responses with `output_text` review JSON and `x-conversation-id: c1` → parsed review + `conversationId === "c1"`. Sequence 413 then 200 after shrink → one shrink call. Three 500s → throw. Assert the request JSON has no `instructions`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/original-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `originalClient` in `src/original/client.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/original-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/original/client.ts tests/original-client.test.ts
git commit -m "feat: call Original responses API with conversation id"
```

---

### Task 12: Publisher (review, 422 retry, check run)

**Files:**
- Modify: `src/host.ts`, `src/github/host.ts`
- Create: `src/review/publish.ts`
- Test: `tests/publish.test.ts`

**Interfaces:**
- Consumes: `Placed` (Task 8); `formatMarker` (Task 9)
- Produces:

```ts
function publishReview(opts: {
  host: GitHost;
  repo: string;
  pr: number;
  sha: string;
  placed: Placed;
  conversationId?: string;
  graphPersisted: boolean;
}): Promise<{ check: "success" | "failure" }>
```

`GitHost.createReview` posts `commit_id`, `body`, `event`, optional `comments`. If status `422`, drop comments whose path/line GitHub named if present, else drop all comments; retry once; if still 422, post body-only. `setCheckRun` name `original-reviewer`. Check conclusion `failure` only when `placed.event === "REQUEST_CHANGES"`; else `success`. If `graphPersisted` is false, append a line `Graph was not persisted.` to the check output (review still published). `upsertIssueComment` finds existing marker via `parseMarker` and patches it.

- [ ] **Step 1: Write the failing test**

Fake `GitHost`: first `createReview` returns 422, second 200; `publishReview` called `createReview` twice and the second payload has no `comments` or fewer comments. `placed.event === "COMMENT"` → check `success`. `REQUEST_CHANGES` → check `failure`. `graphPersisted: false` → check output contains `Graph was not persisted.`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/publish.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `publishReview` in `src/review/publish.ts` and fill `GitHub` `createReview` / `setCheckRun` / `upsertIssueComment` in `src/github/host.ts` using Octokit. Tests inject a fake `GitHost`.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/publish.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/host.ts src/github/host.ts src/review/publish.ts tests/publish.test.ts
git commit -m "feat: publish GitHub reviews and original-reviewer check runs"
```

---

### Task 13: Review orchestrator

**Files:**
- Create: `src/review/run.ts`, `src/connect/store.ts`
- Test: `tests/run.test.ts`

**Interfaces:**
- Consumes: Tasks 2–12
- Produces:

```ts
function originalAuthFor(installationId: number): Promise<OriginalAuth | { kind: "missing-hosted" } | { kind: "missing-selfhost" }>
function runJob(job: Job, deps: { host: GitHost; queue: JobQueue; ... }): Promise<void>
```

Hosted: `connect/store` maps `installationId` → bearer token; missing → `{ kind: "missing-hosted" }`. Self-host: env `ORIGINAL_API_KEY` → `{ kind: "api-key" }`; missing → `{ kind: "missing-selfhost" }`. `runJob`:

1. If `kind === "index"`: clone `job.repo`@`job.sha`, fetch/push graph, no Original, no check.
2. If `kind === "review"`: if queue says sha superseded, return without commenting. `setCheckRun` in_progress. Load yaml from HEAD (invalid → failed check, no review). Skip when draft and `!drafts`. Skip auto-review when `descriptionIgnoresAutoReview` unless the job was triggered by a command (pass `job` flag `fromCommand?: boolean` — add optional `fromCommand?: boolean` and `paused?: boolean` on `ReviewJob` in `src/queue.ts` if missing). Paused + not fromCommand → issue comment `paused` (exact string `paused`). `missing-hosted` → check conclusion `neutral` + comment containing `Connect`. `missing-selfhost` → check `failure`; assert no log/comment contains `ORIGINAL_API_KEY`. Clone `forkRepo ?? repo` at `sha`; graph fetch/push always `job.repo` (base). Assemble first vs follow-up from `parseMarker`. Original. Place. Publish. Push graph; on throw, still publish with `graphPersisted: false`.

- [ ] **Step 1: Write the failing test**

Fake host/queue/original: (a) draft + `drafts: false` → Original fetch call count 0; (b) `missing-hosted` → check conclusion `neutral`; (c) `forkRepo: "alice/app"` and `repo: "acme/app"` → `pushGraph` remote/repo is `acme/app`; (d) missing self-host → failure and serialized comments/logs join() does not include `ORIGINAL_API_KEY`; (e) two jobs sha A then B, cancel A, only B calls Original; (f) PR description contains `@original-reviewer ignore` and `fromCommand` is false → Original fetch count 0.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `runJob` in `src/review/run.ts` and in-memory `connect/store.ts` (Map). Add `fromCommand` to `ReviewJob` if the test needs it.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/review/run.ts src/connect/store.ts src/queue.ts tests/run.test.ts
git commit -m "feat: run review jobs with Original auth and graph persistence"
```

---

### Task 14: HTTP server (webhooks → queue)

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `verifyGitHubSignature` (Task 1), `JobQueue` (Task 2), `parseCommand` (Task 10)
- Produces: Hono app `createApp(deps)` with `POST /github/webhooks`. On valid signature, map `pull_request` opened/synchronize/reopened/ready_for_review → enqueue `review`; `push` to default branch → enqueue `index`; `issue_comment` created on a PR → `parseCommand` and enqueue `review` with `fromCommand: true` for `review`/`full review` (`full: true` when `full review`), or handle pause/resume/help without Original; `check_run` action `rerequested` and name `original-reviewer` → enqueue `review` with `fromCommand: true` and `full: true`. `installation` / `installation_repositories` → 2xx, no job. Invalid signature → HTTP 401 and enqueue count 0. Always 2xx on valid signature before the worker finishes.

- [ ] **Step 1: Write the failing test**

`POST /github/webhooks` with bad sig → 401. With good sig and `pull_request.synchronize` payload fixture → 202 or 200, queue length 1. Body must be the raw string used for HMAC (do not JSON.parse before verify).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `createApp` in `src/server.ts`**

Worker loop: `take()` + `runJob` in the same process.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: accept GitHub App webhooks and enqueue jobs"
```

---

### Task 15: Mini Connect dashboard + default skill

**Files:**
- Create: `src/connect/routes.ts`, `docs/reviewer/SKILL.md`
- Modify: `src/server.ts`, `README.md`
- Test: `tests/connect.test.ts`

**Interfaces:**
- Consumes: `src/connect/store.ts` (Task 13)
- Produces: `GET /` explains install + connect. `GET /connect/original` redirects to Original OAuth (env `ORIGINAL_CONNECT_AUTHORIZE_URL`) with `state=installationId`. `GET /connect/callback` stores bearer via `saveCredential(installationId, token)` and redirects to `/`. Self-host: if `ORIGINAL_API_KEY` is set, `/connect/*` returns 404. Copy dana `docs/reviewer/SKILL.md` into this repo (schema + approval bar; drop dana-only product names if any). README: env vars `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `ORIGINAL_API_BASE`, `ORIGINAL_BOT_ID`, `ORIGINAL_API_KEY` (self-host), Connect URLs (hosted).

- [ ] **Step 1: Write the failing test**

With `ORIGINAL_API_KEY` set, `GET /connect/original` → 404. With it unset, `GET /connect/callback?state=1&code=x` with a mocked token exchange stores installation `1`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/connect.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement routes and copy the skill file. Token exchange URL from env `ORIGINAL_CONNECT_TOKEN_URL`. If those env vars are unset, callback returns 501 (not a crash).**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/connect.test.ts && npx vitest run`
Expected: PASS (full suite)

- [ ] **Step 5: Commit**

```bash
git add src/connect/routes.ts src/server.ts docs/reviewer/SKILL.md README.md tests/connect.test.ts
git commit -m "feat: connect Original accounts and ship the default review skill"
```

---

## Self-review notes

Spec §1–14 mapped: webhook (1,14), queue (2), yaml (3), graph ref (4), graphify AST (5), assemble (6), Original schema/client (7,11), place (8), marker (9), commands (10), publish/checks (12), orchestrator including fork/neutral/self-host (13), HTTP (14), dashboard+skill (15). Out of scope §13 left out. `GitHost` is the provider seam (GitHub only).
