import Redis from "ioredis";

export type ReviewJob = {
  kind: "review";
  installationId: number;
  repo: string;
  forkRepo?: string;
  pr: number;
  sha: string;
  baseSha: string;
  defaultBranch: string;
  fromCommand?: boolean;
  full?: boolean;
  paused?: boolean;
  draft?: boolean;
  description?: string;
};

export type IndexJob = {
  kind: "index";
  installationId: number;
  repo: string;
  sha: string;
};

export type Job = ReviewJob | IndexJob;

export type JobQueue = {
  enqueue(job: Job): Promise<void>;
  take(): Promise<Job | undefined>;
  cancelReview(repo: string, pr: number, exceptSha: string): Promise<number>;
  isCurrentReview(repo: string, pr: number, sha: string): Promise<boolean>;
};

function reviewKey(repo: string, pr: number): string {
  return `${repo}#${pr}`;
}

function isSupersededReview(job: Job, repo: string, pr: number, exceptSha: string): boolean {
  return job.kind === "review" && job.repo === repo && job.pr === pr && job.sha !== exceptSha;
}

export function memoryQueue(): JobQueue {
  const jobs: Job[] = [];
  const currentSha = new Map<string, string>();
  return {
    enqueue(job) {
      jobs.push(job);
      if (job.kind === "review") currentSha.set(reviewKey(job.repo, job.pr), job.sha);
      return Promise.resolve();
    },
    take() {
      return Promise.resolve(jobs.shift());
    },
    cancelReview(repo, pr, exceptSha) {
      currentSha.set(reviewKey(repo, pr), exceptSha);
      const before = jobs.length;
      for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        if (job && isSupersededReview(job, repo, pr, exceptSha)) jobs.splice(i, 1);
      }
      return Promise.resolve(before - jobs.length);
    },
    isCurrentReview(repo, pr, sha) {
      const current = currentSha.get(reviewKey(repo, pr));
      return Promise.resolve(current === undefined || current === sha);
    },
  };
}

function parseJob(raw: string): Job {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw new Error("invalid job json");
  }
  const { kind } = (value);
  if (kind !== "review" && kind !== "index") throw new Error("invalid job kind");
  return value as Job;
}

export function redisQueue(url: string): JobQueue {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const listKey = "original-reviewer:jobs";
  return {
    async enqueue(job) {
      await redis.rpush(listKey, JSON.stringify(job));
      if (job.kind === "review") {
        await redis.set(`review:${job.repo}:${job.pr}:sha`, job.sha);
      }
    },
    async take() {
      const raw = await redis.lpop(listKey);
      if (raw === null) return undefined;
      return parseJob(raw);
    },
    async cancelReview(repo, pr, exceptSha) {
      await redis.set(`review:${repo}:${pr}:sha`, exceptSha);
      const items = await redis.lrange(listKey, 0, -1);
      let dropped = 0;
      for (const raw of items) {
        const job = parseJob(raw);
        if (isSupersededReview(job, repo, pr, exceptSha)) {
          dropped += await redis.lrem(listKey, 1, raw);
        }
      }
      return dropped;
    },
    async isCurrentReview(repo, pr, sha) {
      const current = await redis.get(`review:${repo}:${pr}:sha`);
      return current === null || current === sha;
    },
  };
}
