export function loadEnv(): {
  webhookSecret: string;
  githubAppSlug: string;
  originalApiBase: string;
  originalBotId: string;
  messageBudget: number;
  } {
  return {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    githubAppSlug: process.env.GITHUB_APP_SLUG ?? "original-reviewer",
    originalApiBase: process.env.ORIGINAL_API_BASE ?? "",
    originalBotId: process.env.ORIGINAL_BOT_ID ?? "",
    messageBudget: 400000,
  };
}
