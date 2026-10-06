import Redis from "ioredis";

const HASH = "original-reviewer:credentials";
const credentials = new Map<number, string>();
const pkce = new Map<string, string>();
let redis: Redis | undefined;

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

export function savePkce(state: string, verifier: string): void {
  pkce.set(state, verifier);
}

export function takePkce(state: string): string | undefined {
  const verifier = pkce.get(state);
  pkce.delete(state);
  return verifier;
}

export function clearCredentials(): void {
  credentials.clear();
  pkce.clear();
}
