# Original Reviewer

[![CI](https://github.com/noku-team/original-reviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/noku-team/original-reviewer/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Bun-1.3+-000?logo=bun&logoColor=fff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org/)
[![ESLint](https://img.shields.io/badge/ESLint-Airbnb-4B32C3?logo=eslint&logoColor=fff)](https://eslint.org/)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=fff)](https://vitest.dev/)

GitHub App for CodeRabbit-shaped pull request review. Inference runs on a public [Original](https://ai.original.land) agent. Context comes from a persistent graphify AST graph stored on `refs/original-reviewer/graph` — not a dump of the whole repo into the prompt.

```
GitHub webhook ──► queue ──► clone HEAD
                               │
                               ▼
                         graphify update (AST only)
                               │
                               ▼
                    assemble skill + diff + graph slice
                               │
                               ▼
                    Original POST  /api/responses/v1/{bot}
                               │
                               ▼
              review + inline comments + check run
                               │
                               ▼
                    push graph ref (best-effort)
```

Same binary for hosted (Original Connect) and self-host (`ORIGINAL_API_KEY`).

---

## Install

### 1. Bun 1.3+

```bash
curl -fsSL https://bun.sh/install | bash
# reopen the shell, then:
bun --version   # >= 1.3.0
```

Also needed: **Git**, and a **GitHub App**. Optional: **Redis** (hosted / multi-process), **graphify** on `PATH` (AST graph; skipped if missing).

### 2. Clone and install

```bash
git clone git@github.com:noku-team/original-reviewer.git
cd original-reviewer
bun install
```

Lockfile is `bun.lock`. Do not use npm/pnpm.

### 3. Environment

```bash
cp .env.example .env
```

Bun loads `.env` automatically. Fill the values:

| Variable | Required | Notes |
| --- | --- | --- |
| `GITHUB_APP_ID` | yes | GitHub App id |
| `GITHUB_PRIVATE_KEY` | yes | PEM for the App (newlines allowed) |
| `GITHUB_WEBHOOK_SECRET` | yes | verifies `X-Hub-Signature-256` |
| `GITHUB_APP_SLUG` | no | mention slug, default `original-reviewer` |
| `ORIGINAL_API_BASE` | yes | e.g. `https://ai-api.original.land` |
| `ORIGINAL_BOT_ID` | yes | public reviewer bot id |
| `ORIGINAL_API_KEY` | self-host | disables `/connect/*` |
| `ORIGINAL_CONNECT_AUTHORIZE_URL` | hosted | OAuth authorize |
| `ORIGINAL_CONNECT_TOKEN_URL` | hosted | OAuth token exchange |
| `PORT` | no | default `3000` |
| `REDIS_URL` | no | in-memory queue if unset |

Never set `GEMINI_API_KEY` or `GOOGLE_API_KEY` on the worker. Graphify must stay AST-only.

### 4. GitHub App

Create an App at [github.com/settings/apps](https://github.com/settings/apps/new):

**Permissions**

| Permission | Access |
| --- | --- |
| Contents | Read & write (clone + graph ref) |
| Pull requests | Read & write |
| Checks | Read & write |
| Issues | Read & write (marker comment) |

**Events:** `pull_request`, `issue_comment`, `pull_request_review_comment`, `push`, `check_run`, `installation`, `installation_repositories`.

**Webhook URL:** `https://<your-host>/github/webhooks`  
**Webhook secret:** same value as `GITHUB_WEBHOOK_SECRET`.

Install the App on a repository.

### 5. Run

```bash
bun run dev
```

Listens on `PORT` (default 3000).

- Self-host: set `ORIGINAL_API_KEY`, skip Connect.
- Hosted: leave the API key empty, open `/connect/original?installation_id=<id>` after installing the App.

Health copy is at `GET /`.

### 6. Repo under review

Optional `.original-reviewer.yaml` at the **feature branch** root:

```yaml
language: en-US
reviews:
  request_changes_workflow: false
  auto_review:
    enabled: true
    drafts: false
  path_filters: []
  path_instructions: []
```

Missing file → those defaults. Invalid YAML → failed check, no review.

Guideline files loaded when present: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `docs/reviewer/SKILL.md`.

---

## Commands

Mention the App on a PR comment (`GITHUB_APP_SLUG`, default `original-reviewer`):

| Comment | Effect |
| --- | --- |
| `@original-reviewer review` | enqueue a review |
| `@original-reviewer full review` | full review (ignore conversation id) |
| `@original-reviewer pause` | stop auto-review |
| `@original-reviewer resume` | resume auto-review |
| `@original-reviewer help` | acknowledged, no job |
| `@original-reviewer ignore` in the PR body | skip auto-review (explicit `review` still runs) |

Re-run the `original-reviewer` check from the Checks UI to enqueue a full review of HEAD.

---

## Develop

```bash
bun install
bun run lint      # ESLint Airbnb + tsc --noEmit
bun run test      # Vitest; no GitHub, no Original
bun run dev
```

CI is GitHub Actions (`.github/workflows/ci.yml`): `bun install --frozen-lockfile`, lint, test. The graphify opt-in test is skipped when the CLI is not installed.

**Default review skill:** [docs/reviewer/SKILL.md](docs/reviewer/SKILL.md)  
**Design spec:** [docs/superpowers/specs/2026-10-06-original-reviewer-design.md](docs/superpowers/specs/2026-10-06-original-reviewer-design.md)  
**Implementation plan:** [docs/superpowers/plans/2026-10-06-original-reviewer-core.md](docs/superpowers/plans/2026-10-06-original-reviewer-core.md)
