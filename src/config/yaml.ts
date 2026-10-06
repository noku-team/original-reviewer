import { minimatch } from "minimatch";
import { parse } from "yaml";

export type ReviewerConfig = {
  language: string;
  requestChangesWorkflow: boolean;
  autoReview: { enabled: boolean; drafts: boolean };
  pathFilters: string[];
  pathInstructions: { path: string; instructions: string }[];
};

const DEFAULTS: ReviewerConfig = {
  language: "en-US",
  requestChangesWorkflow: false,
  autoReview: { enabled: true, drafts: false },
  pathFilters: [],
  pathInstructions: [],
};

const DEFAULT_IGNORES = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/npm-shrinkwrap.json",
  "**/Cargo.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/go.sum",
  "**/*.lock",
  "**/dist/**",
  "**/node_modules/**",
  "**/build/**",
  "**/coverage/**",
  "**/generated/**",
  "**/*.generated.*",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.{exe,dll,so,dylib,bin,class,o,a,jar,war,wasm}",
  "**/*.{png,jpg,jpeg,gif,webp,ico,mp3,mp4,mov,avi,webm,wav,flac,woff,woff2,ttf,eot,pdf}",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function invalid(detail: string): Error {
  return new Error(`invalid .original-reviewer.yaml: ${detail}`);
}

export function parseReviewerYaml(text: string | null): ReviewerConfig {
  if (text === null || text.trim() === "") return { ...DEFAULTS, autoReview: { ...DEFAULTS.autoReview } };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    throw invalid(err instanceof Error ? err.message : String(err));
  }
  if (doc === null || doc === undefined) {
    return { ...DEFAULTS, autoReview: { ...DEFAULTS.autoReview } };
  }
  if (!isRecord(doc)) throw invalid("root must be a mapping");
  const reviews = isRecord(doc.reviews) ? doc.reviews : {};
  const auto = isRecord(reviews.auto_review) ? reviews.auto_review : {};
  return {
    language: asString(doc.language, DEFAULTS.language),
    requestChangesWorkflow: asBool(reviews.request_changes_workflow, DEFAULTS.requestChangesWorkflow),
    autoReview: {
      enabled: asBool(auto.enabled, DEFAULTS.autoReview.enabled),
      drafts: asBool(auto.drafts, DEFAULTS.autoReview.drafts),
    },
    pathFilters: stringList(reviews.path_filters),
    pathInstructions: instructionList(reviews.path_instructions),
  };
}

function stringList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalid("path_filters must be a string list");
  }
  return value.filter((item): item is string => typeof item === "string");
}

function instructionList(value: unknown): { path: string; instructions: string }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid("path_instructions must be a list");
  return value.map((item, i) => {
    if (!isRecord(item) || typeof item.path !== "string" || typeof item.instructions !== "string") {
      throw invalid(`path_instructions[${i}] must have path and instructions`);
    }
    return { path: item.path, instructions: item.instructions };
  });
}

function matches(path: string, glob: string): boolean {
  return minimatch(path, glob, { dot: true });
}

export function isIgnoredPath(path: string, config: ReviewerConfig): boolean {
  if (DEFAULT_IGNORES.some((glob) => matches(path, glob))) return true;
  const excludes = config.pathFilters.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  const includes = config.pathFilters.filter((g) => !g.startsWith("!"));
  if (excludes.some((glob) => matches(path, glob))) return true;
  if (includes.length > 0 && !includes.some((glob) => matches(path, glob))) return true;
  return false;
}
