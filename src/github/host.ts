import type { GitHost } from "../host.ts";
import { GRAPH_REF } from "../graph/ref.ts";

function notImplemented(): never {
  throw new Error("not implemented");
}

export function githubHost(): GitHost {
  void GRAPH_REF;
  return {
    clone: async () => notImplemented(),
    createReview: async () => notImplemented(),
    upsertIssueComment: async () => notImplemented(),
    setCheckRun: async () => notImplemented(),
  };
}
