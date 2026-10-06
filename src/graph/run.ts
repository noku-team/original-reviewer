import { spawn } from "node:child_process";

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  return env;
}

export function runGraphifyUpdate(dir: string): Promise<{ ok: boolean; skippedMissing: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("graphify", ["update", "."], { cwd: dir, env: childEnv() });
    child.on("error", (err) => {
      if (typeof err === "object" && "code" in err && err.code === "ENOENT") {
        resolve({ ok: false, skippedMissing: true });
        return;
      }
      resolve({ ok: false, skippedMissing: false });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, skippedMissing: false });
    });
  });
}
