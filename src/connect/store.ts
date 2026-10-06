// ponytail: in-memory Map as Task 13 specified. Lost on deploy.
// Upgrade: persist behind REDIS_URL the same way redisQueue does.
const credentials = new Map<number, string>();

export function saveCredential(installationId: number, token: string): void {
  credentials.set(installationId, token);
}

export function getCredential(installationId: number): string | undefined {
  return credentials.get(installationId);
}

export function clearCredentials(): void {
  credentials.clear();
}
