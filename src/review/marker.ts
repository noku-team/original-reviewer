import type { Finding } from "../original/schema.ts";

export function formatMarker(opts: {
  conversationId: string | undefined;
  sha: string;
  summary: string;
  kept: Finding[];
}): string {
  const id = opts.conversationId ?? "none";
  return [
    `<!-- original-review conversation=${id} sha=${opts.sha} -->`,
    "",
    opts.summary,
    "",
    "<!-- findings-json",
    JSON.stringify(opts.kept),
    "-->",
  ].join("\n");
}

function parseKept(raw: string): Finding[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  const kept: Finding[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec.severity !== "minor" && rec.severity !== "blocking") continue;
    if (typeof rec.path !== "string" || typeof rec.line !== "number") continue;
    if (rec.side !== "LEFT" && rec.side !== "RIGHT") continue;
    if (typeof rec.text !== "string") continue;
    const finding: Finding = {
      severity: rec.severity,
      path: rec.path,
      line: rec.line,
      side: rec.side,
      text: rec.text,
    };
    if (typeof rec.suggested_fix === "string") finding.suggested_fix = rec.suggested_fix;
    kept.push(finding);
  }
  return kept;
}

export function parseMarker(body: string): {
  conversationId: string | undefined;
  sha: string | undefined;
  kept: Finding[];
} | undefined {
  if (!body.startsWith("<!-- original-review")) return undefined;
  const first = body.split("\n", 1)[0] ?? "";
  const conversation = /conversation=(\S+)/.exec(first)?.[1];
  const sha = /sha=([^ >]+)/.exec(first)?.[1];
  const jsonBlock = /<!-- findings-json\n(.*)\n-->/s.exec(body);
  let kept: Finding[] = [];
  if (jsonBlock?.[1]) {
    try {
      kept = parseKept(jsonBlock[1]);
    } catch {
      kept = [];
    }
  }
  return {
    conversationId: conversation && conversation !== "none" ? conversation : undefined,
    sha,
    kept,
  };
}
