import type { Finding, Review } from "../original/schema.ts";

export type Placed = {
  event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  summary: string;
  comments: { path: string; line: number; side: "LEFT" | "RIGHT"; body: string }[];
  kept: Finding[];
};

type Anchor = { path: string; line: number; side: "LEFT" | "RIGHT" };

function anchorKey(a: Anchor): string {
  return `${a.path}\0${a.line}\0${a.side}`;
}

function anchorsFromDiff(diff: string): Set<string> {
  const anchors = new Set<string>();
  let path: string | undefined;
  let oldLine: number | undefined;
  let newLine: number | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      path = line.slice(6);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (path === undefined || oldLine === undefined || newLine === undefined) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      anchors.add(anchorKey({ path, line: newLine, side: "RIGHT" }));
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      anchors.add(anchorKey({ path, line: oldLine, side: "LEFT" }));
      oldLine += 1;
    } else if (line.startsWith("\\")) {
      continue;
    } else {
      anchors.add(anchorKey({ path, line: newLine, side: "RIGHT" }));
      oldLine += 1;
      newLine += 1;
    }
  }
  return anchors;
}

function commentBody(finding: Finding): string {
  let body = `_${finding.severity}_\n\n${finding.text}`;
  const fix = finding.suggested_fix?.trim();
  if (fix) body += `\n\n\`\`\`diff\n${fix}\n\`\`\``;
  return body;
}

export function placeFindings(opts: {
  diff: string;
  review: Review;
  requestChangesWorkflow: boolean;
}): Placed {
  const anchors = anchorsFromDiff(opts.diff);
  const comments: Placed["comments"] = [];
  const kept: Finding[] = [];
  let blocking = false;
  for (const finding of opts.review.findings) {
    if (!anchors.has(anchorKey(finding))) continue;
    comments.push({
      path: finding.path,
      line: finding.line,
      side: finding.side,
      body: commentBody(finding),
    });
    kept.push(finding);
    if (finding.severity === "blocking") blocking = true;
  }
  let event: Placed["event"] = "COMMENT";
  if (opts.requestChangesWorkflow) event = blocking ? "REQUEST_CHANGES" : "APPROVE";
  return {
    event,
    summary: `${opts.review.summary}\n\nActionable comments posted: ${comments.length}`,
    comments,
    kept,
  };
}
