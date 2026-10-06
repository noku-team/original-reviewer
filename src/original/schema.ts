export type Finding = {
  severity: "minor" | "blocking";
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  text: string;
  suggested_fix?: string | undefined;
};

export type Review = { summary: string; findings: Finding[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFinding(value: unknown): Finding {
  if (!isRecord(value)) throw new Error("invalid finding");
  if (value.severity !== "minor" && value.severity !== "blocking") {
    throw new Error("invalid finding severity");
  }
  if (typeof value.path !== "string") throw new Error("invalid finding path");
  if (typeof value.line !== "number") throw new Error("invalid finding line");
  if (value.side !== "LEFT" && value.side !== "RIGHT") throw new Error("invalid finding side");
  if (typeof value.text !== "string") throw new Error("invalid finding text");
  const finding: Finding = {
    severity: value.severity,
    path: value.path,
    line: value.line,
    side: value.side,
    text: value.text,
  };
  if (typeof value.suggested_fix === "string") finding.suggested_fix = value.suggested_fix;
  return finding;
}

function asReview(value: unknown): Review {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.findings)) {
    throw new Error("review is missing summary or findings");
  }
  return { summary: value.summary, findings: value.findings.map(parseFinding) };
}

function fromOpenResponses(value: unknown): Review | undefined {
  if (!isRecord(value) || !Array.isArray(value.output)) return undefined;
  const texts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") {
        texts.push(part.text);
      }
    }
  }
  if (texts.length === 0) return undefined;
  const last = texts.at(-1);
  if (last === undefined) return undefined;
  return asReview(JSON.parse(last) as unknown);
}

export function parseReview(outputText: string): Review {
  const parsed: unknown = JSON.parse(outputText);
  const fromDoc = fromOpenResponses(parsed);
  if (fromDoc) return fromDoc;
  return asReview(parsed);
}

const PR_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["minor", "blocking"] },
          path: { type: "string" },
          line: { type: "integer" },
          side: { type: "string", enum: ["LEFT", "RIGHT"] },
          text: { type: "string" },
          suggested_fix: { type: "string" },
        },
        required: ["severity", "path", "line", "side", "text"],
      },
    },
  },
  required: ["summary", "findings"],
};

export function originalRequestBody(message: string, model?: string): unknown {
  const body: Record<string, unknown> = {
    stream: false,
    input: [{ type: "message", role: "user", content: message }],
    text: {
      format: {
        type: "json_schema",
        name: "pr_review",
        strict: true,
        schema: PR_REVIEW_SCHEMA,
      },
    },
  };
  if (model) body.model = model;
  return body;
}
