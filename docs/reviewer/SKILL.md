# Original Reviewer

Reply with one JSON object for schema `pr_review`. No prose before or after it.

```json
{
  "summary": "short markdown review of this diff",
  "findings": [
    {
      "severity": "minor",
      "path": "path/from/the/diff.ts",
      "line": 1,
      "side": "RIGHT",
      "text": "what is wrong and why",
      "suggested_fix": "optional unified diff"
    }
  ]
}
```

`severity` is `minor` or `blocking`. `side` is `RIGHT` for added or context lines, `LEFT` for deletions. `line` must exist in the diff. Empty `findings` is fine when the change is good. Blocking means do not merge as-is.

Review the pull request diff. Use the graph slice only for call-site context. Do not invent files or lines that are not in the diff.
