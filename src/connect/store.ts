// ponytail: in-memory Map as Task 13 specified. Lost on restart.
// Upgrade: persist behind REDIS_URL the same way redisQueue does.
const credentials = new Map<number, string>();
const pkce = new Map<string, string>();

export function saveCredential(installationId: number, token: string): void {
  credentials.set(installationId, token);
}

export function getCredential(installationId: number): string | undefined {
  return credentials.get(installationId);
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
