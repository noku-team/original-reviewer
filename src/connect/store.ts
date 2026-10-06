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
