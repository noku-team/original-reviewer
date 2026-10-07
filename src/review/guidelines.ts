import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", "docs/reviewer/SKILL.md"];

export async function loadGuidelines(root: string): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const name of ROOT_FILES) {
    try {
      out.push({ path: name, text: await readFile(join(root, name), "utf8") });
    } catch {
      // missing guideline
    }
  }
  await walk(join(root, ".cursor", "rules"), ".cursor/rules", out);
  return out;
}

async function walk(
  abs: string,
  rel: string,
  out: { path: string; text: string }[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const nextAbs = join(abs, entry.name);
    const nextRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) await walk(nextAbs, nextRel, out);
    else if (entry.isFile()) {
      try {
        out.push({ path: nextRel, text: await readFile(nextAbs, "utf8") });
      } catch {
        // unreadable
      }
    }
  }
}
