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

export const HELP_TEXT = [
  "`@original-reviewer review` — incremental review",
  "`@original-reviewer full review` — re-review the whole diff",
  "`@original-reviewer pause` / `resume` — stop or restart auto-review",
  "`@original-reviewer help` — this list",
].join("\n");

export function commandAllowed(opts: {
  senderLogin?: string | undefined;
  senderType?: string | undefined;
  authorAssociation?: string | undefined;
  issueAuthorLogin?: string | undefined;
  slug: string;
}): boolean {
  const login = opts.senderLogin ?? "";
  if (opts.senderType === "Bot" || login === `${opts.slug}[bot]`) return false;
  if (opts.issueAuthorLogin && login === opts.issueAuthorLogin) return true;
  return opts.authorAssociation === "OWNER"
    || opts.authorAssociation === "MEMBER"
    || opts.authorAssociation === "COLLABORATOR";
}
