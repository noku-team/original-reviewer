# Original Reviewer

Open-source GitHub App for CodeRabbit-shaped pull request review. Inference runs on a public Original agent ([ai.original.land](https://ai.original.land)); context comes from a persistent graphify AST graph stored in the repo.

**Design spec (this slice):** [docs/superpowers/specs/2026-10-06-original-reviewer-design.md](docs/superpowers/specs/2026-10-06-original-reviewer-design.md)

**Implementation plan:** [docs/superpowers/plans/2026-10-06-original-reviewer-core.md](docs/superpowers/plans/2026-10-06-original-reviewer-core.md)

**Default review skill:** [docs/reviewer/SKILL.md](docs/reviewer/SKILL.md)

## Run

```bash
npm install
npm test
npm run dev
```

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `GITHUB_APP_ID` | yes | GitHub App id |
| `GITHUB_PRIVATE_KEY` | yes | PEM for the App |
| `GITHUB_WEBHOOK_SECRET` | yes | `X-Hub-Signature-256` |
| `GITHUB_APP_SLUG` | no | default `original-reviewer` |
| `ORIGINAL_API_BASE` | yes | e.g. `https://ai-api.original.land` |
| `ORIGINAL_BOT_ID` | yes | public reviewer bot id |
| `ORIGINAL_API_KEY` | self-host | disables `/connect/*` |
| `ORIGINAL_CONNECT_AUTHORIZE_URL` | hosted | OAuth authorize |
| `ORIGINAL_CONNECT_TOKEN_URL` | hosted | OAuth token exchange |

The graph lives at `refs/original-reviewer/graph`. Graphify runs AST-only; do not set `GEMINI_API_KEY` or `GOOGLE_API_KEY` in the worker.
