export type Command =
  | { type: "review"; full: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "help" }
  | { type: "none" };

export function parseCommand(body: string, slug: string): Command {
  const mention = `@${slug}`;
  const idx = body.indexOf(mention);
  if (idx < 0) return { type: "none" };
  const rest = body.slice(idx + mention.length);
  if (/\bfull review\b/i.test(rest)) return { type: "review", full: true };
  if (/\breview\b/i.test(rest)) return { type: "review", full: false };
  if (/\bpause\b/i.test(rest)) return { type: "pause" };
  if (/\bresume\b/i.test(rest)) return { type: "resume" };
  if (/\bhelp\b/i.test(rest)) return { type: "help" };
  return { type: "none" };
}

export function descriptionIgnoresAutoReview(description: string, slug: string): boolean {
  return description.includes(`@${slug} ignore`);
}
