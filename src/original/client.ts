import { originalRequestBody, parseReview, type Review } from "./schema.ts";

export type OriginalAuth = { kind: "api-key"; key: string } | { kind: "bearer"; token: string };

export type OriginalClient = {
  review(opts: {
    messages: string[];
    conversationId?: string;
    auth: OriginalAuth;
    shrink: () => string[] | undefined;
  }): Promise<{ review: Review; conversationId?: string }>;
};

function authHeaders(auth: OriginalAuth): Record<string, string> {
  switch (auth.kind) {
    case "api-key":
      return { "x-api-key": auth.key };
    case "bearer":
      return { Authorization: `Bearer ${auth.token}` };
    default: {
      const _never: never = auth;
      return _never;
    }
  }
}

function conversationFrom(headers: Headers): string | undefined {
  return headers.get("x-conversation-id") ?? undefined;
}

export function originalClient(opts: {
  baseUrl: string;
  botId: string;
  fetch?: typeof fetch;
}): OriginalClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/responses/v1/${opts.botId}`;

  async function post(
    message: string,
    auth: OriginalAuth,
    conversationId: string | undefined,
  ): Promise<{ review: Review; conversationId?: string; status: number }> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...authHeaders(auth),
      };
      if (conversationId) headers["X-Conversation-Id"] = conversationId;
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(originalRequestBody(message)),
        });
      } catch {
        lastStatus = 0;
        continue;
      }
      lastStatus = response.status;
      if (response.status === 413) throw new Error("original 413");
      if (response.status >= 500) continue;
      const text = await response.text();
      if (!response.ok) throw new Error(`original ${response.status}`);
      return {
        review: parseReview(text),
        conversationId: conversationFrom(response.headers) ?? conversationId,
        status: response.status,
      };
    }
    throw new Error(lastStatus === 0 ? "original timeout" : `original ${lastStatus}`);
  }

  return {
    async review(input) {
      let messages = input.messages;
      let conversationId = input.conversationId;
      let shrunk = false;
      for (;;) {
        try {
          const reviews: Review[] = [];
          for (const message of messages) {
            const result = await post(message, input.auth, conversationId);
            conversationId = result.conversationId ?? conversationId;
            reviews.push(result.review);
          }
          return {
            review: {
              summary: reviews.map((r) => r.summary).join("\n\n"),
              findings: reviews.flatMap((r) => r.findings),
            },
            conversationId,
          };
        } catch (err) {
          if (err instanceof Error && err.message === "original 413" && !shrunk) {
            shrunk = true;
            const next = input.shrink();
            if (!next) throw err;
            messages = next;
            continue;
          }
          throw err;
        }
      }
    },
  };
}
