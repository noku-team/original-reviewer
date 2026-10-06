export type AssembleInput = {
  skill: string;
  diff: string;
  graphJson: unknown;
  guidelines: { path: string; text: string }[];
  changedSymbols: string[];
  budget: number;
  mode: "first" | "follow-up";
  previousFindings?: unknown;
};

export type AssembleResult = { messages: string[] };

function bytes(text: string): number {
  return Buffer.byteLength(text);
}

function nodeId(node: Record<string, unknown>): string | undefined {
  if (typeof node.id === "string") return node.id;
  if (typeof node.label === "string") return node.label;
  return undefined;
}

function linkEnd(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return undefined;
}

function sliceGraph(graphJson: unknown, changedSymbols: string[]): unknown {
  if (typeof graphJson !== "object" || graphJson === null) return { nodes: [], links: [] };
  const rec = graphJson as { nodes?: unknown; links?: unknown };
  const nodes = Array.isArray(rec.nodes)
    ? rec.nodes.filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
    : [];
  const links = Array.isArray(rec.links)
    ? rec.links.filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    : [];
  const keep = new Set(changedSymbols);
  for (const link of links) {
    const source = linkEnd(link.source);
    const target = linkEnd(link.target);
    if (source && keep.has(source) && target) keep.add(target);
    if (target && keep.has(target) && source) keep.add(source);
  }
  return {
    nodes: nodes.filter((node) => {
      const id = nodeId(node);
      return id !== undefined && keep.has(id);
    }),
    links: links.filter((link) => {
      const source = linkEnd(link.source);
      const target = linkEnd(link.target);
      return source !== undefined && target !== undefined && keep.has(source) && keep.has(target);
    }),
  };
}

function extraChunks(input: AssembleInput): string[] {
  const chunks: string[] = [];
  if (input.guidelines.length > 0) {
    const body = input.guidelines.map((g) => `### ${g.path}\n\n${g.text}`).join("\n\n");
    chunks.push(`\n\n## Guidelines\n\n${body}`);
  }
  const graph = sliceGraph(input.graphJson, input.changedSymbols);
  const graphText = JSON.stringify(graph);
  if (graphText !== '{"nodes":[],"links":[]}') {
    chunks.push(`\n\n## Graph slice\n\n${graphText}`);
  }
  return chunks;
}

function fitExtras(first: string, chunks: string[], budget: number): string {
  let out = first;
  for (const chunk of chunks) {
    if (bytes(out + chunk) <= budget) out += chunk;
  }
  return out;
}

function header(input: AssembleInput): string {
  if (input.mode === "first") {
    return `## Review skill\n\n${input.skill}\n\n## Pull request diff\n\n`;
  }
  const findings = input.previousFindings === undefined
    ? ""
    : `## Previous findings\n\n${JSON.stringify(input.previousFindings)}\n\n`;
  return `${findings}## Pull request diff\n\n`;
}

function splitUtf8(text: string, limit: number): string[] {
  if (limit < 1) return [text];
  const raw = Buffer.from(text);
  if (raw.length <= limit) return [text];
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i += limit) {
    parts.push(raw.subarray(i, i + limit).toString("utf8"));
  }
  return parts;
}

export function assembleContext(input: AssembleInput): AssembleResult {
  const prefix = header(input);
  const continued = "## Pull request diff (continued)\n\n";
  if (bytes(input.diff) <= input.budget) {
    const first = fitExtras(prefix + input.diff, extraChunks(input), input.budget);
    return { messages: [first] };
  }
  const firstRoom = Math.max(1, input.budget - bytes(prefix));
  const nextRoom = Math.max(1, input.budget - bytes(continued));
  const firstParts = splitUtf8(input.diff, firstRoom);
  const messages = [prefix + firstParts[0]];
  const rest = firstParts.slice(1).join("");
  for (const part of splitUtf8(rest, nextRoom)) {
    if (part) messages.push(continued + part);
  }
  return { messages };
}
