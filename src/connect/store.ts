import Redis from "ioredis";

const HASH = "original-reviewer:credentials";
const PAUSED = "original-reviewer:paused";
const credentials = new Map<number, string>();
const pkce = new Map<string, PkceRecord>();
const paused = new Set<string>();
let redis: Redis | undefined;

export type PkceRecord = { installationId: number; verifier: string };

export async function initCredentialStore(url?: string): Promise<boolean> {
  if (redis) {
    redis.disconnect();
    redis = undefined;
  }
  if (!url) return false;
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
  try {
    await client.ping();
    redis = client;
    return true;
  } catch {
    client.disconnect();
    return false;
  }
}

export async function saveCredential(installationId: number, token: string): Promise<void> {
  credentials.set(installationId, token);
  if (redis) await redis.hset(HASH, String(installationId), token);
}

export async function getCredential(installationId: number): Promise<string | undefined> {
  const cached = credentials.get(installationId);
  if (cached) return cached;
  if (!redis) return undefined;
  const token = await redis.hget(HASH, String(installationId));
  if (token) credentials.set(installationId, token);
  return token ?? undefined;
}

export async function savePkce(state: string, record: PkceRecord): Promise<void> {
  pkce.set(state, record);
  if (redis) await redis.set(`original-reviewer:pkce:${state}`, JSON.stringify(record), "EX", 600);
}

export async function takePkce(state: string): Promise<PkceRecord | undefined> {
  const local = pkce.get(state);
  pkce.delete(state);
  if (local) {
    if (redis) await redis.del(`original-reviewer:pkce:${state}`);
    return local;
  }
  if (!redis) return undefined;
  const raw = await redis.get(`original-reviewer:pkce:${state}`);
  if (raw) await redis.del(`original-reviewer:pkce:${state}`);
  if (!raw) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object"
    || parsed === null
    || !("installationId" in parsed)
    || !("verifier" in parsed)
    || typeof parsed.installationId !== "number"
    || typeof parsed.verifier !== "string"
  ) {
    return undefined;
  }
  return { installationId: parsed.installationId, verifier: parsed.verifier };
}

export async function setPaused(key: string, on: boolean): Promise<void> {
  if (on) paused.add(key);
  else paused.delete(key);
  if (!redis) return;
  if (on) await redis.sadd(PAUSED, key);
  else await redis.srem(PAUSED, key);
}

export async function isPaused(key: string): Promise<boolean> {
  if (paused.has(key)) return true;
  if (!redis) return false;
  return (await redis.sismember(PAUSED, key)) === 1;
}

export function clearCredentials(): void {
  credentials.clear();
  pkce.clear();
  paused.clear();
}
