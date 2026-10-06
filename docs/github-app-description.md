**Line-level pull request review, powered by [Original](https://original.land).**

A check run, a written summary, and comments on the lines you actually changed — not a wall of linter noise, not a dump of the whole repo into a prompt.

### What you get

- **Inline findings** on the diff (`LEFT` / `RIGHT`), with optional suggested fixes
- **Check run** `original-reviewer` (re-run from Checks for a full review of HEAD)
- **Incremental follow-up** — later pushes reuse the Original conversation
- **Commands** on the PR, by mentioning the App

### How it stays repo-aware

Context is a **persistent AST graph** stored in *your* repository at `refs/original-reviewer/graph`.

- Structural only (tree-sitter / AST). **No LLM is used to build the graph.**
- No third-party code index. The clone lives for the job, then it is deleted.
- Inference is billed to the **Original account you connect**, not a shared vendor key.

### Commands

| Comment | Effect |
| --- | --- |
| `@original-reviewer review` | Incremental review |
| `@original-reviewer full review` | Re-review the whole diff |
| `@original-reviewer pause` / `resume` | Stop or restart auto-review |
| `@original-reviewer help` | Command list |
| `@original-reviewer ignore` in the PR **body** | Skip auto-review (explicit `review` still runs) |

### Privacy, in one line

GitHub talks to the App with an **installation token** (never the PR author’s token). Original sees only the assembled review slice: skill, diff, graph neighborhood, guideline files.

Open source: [noku-team/original-reviewer](https://github.com/noku-team/original-reviewer).
