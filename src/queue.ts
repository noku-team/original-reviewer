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
};

function reviewKey(repo: string, pr: number): string {
  return `${repo}#${pr}`;
}

function isReview(job: Job): job is ReviewJob {
  return job.kind === "review";
}

function isCurrent(job: ReviewJob, current: string | undefined): boolean {
  return current === undefined || current === job.sha;
}

export function memoryQueue(): JobQueue {
  const jobs: Job[] = [];
  const current = new Map<string, string>();

  return {
    async enqueue(job) {
      jobs.push(job);
    },
    async take() {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job === undefined) continue;
        if (isReview(job) && !isCurrent(job, current.get(reviewKey(job.repo, job.pr)))) {
          continue;
        }
        jobs.splice(i, 1);
        return job;
      }
      return undefined;
    },
    async cancelReview(repo, pr, exceptSha) {
      current.set(reviewKey(repo, pr), exceptSha);
      let n = 0;
      for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        if (job !== undefined && isReview(job) && job.repo === repo && job.pr === pr && job.sha !== exceptSha) {
          jobs.splice(i, 1);
          n++;
        }
      }
      return n;
    },
  };
}

const JOBS_KEY = "jobs";

function shaKey(repo: string, pr: number): string {
  return `review:${repo}:${pr}:sha`;
}

function parseJob(raw: string): Job {
  return JSON.parse(raw) as Job;
}

export function redisQueue(url: string): JobQueue {
  const redis = new Redis(url);
  return {
    async enqueue(job) {
      await redis.rpush(JOBS_KEY, JSON.stringify(job));
    },
    async take() {
      const len = await redis.llen(JOBS_KEY);
      for (let i = 0; i < len; i++) {
        const raw = await redis.lpop(JOBS_KEY);
        if (raw === null) return undefined;
        const job = parseJob(raw);
        if (isReview(job)) {
          const want = await redis.get(shaKey(job.repo, job.pr));
          if (want !== null && want !== job.sha) continue;
        }
        return job;
      }
      return undefined;
    },
    async cancelReview(repo, pr, exceptSha) {
      await redis.set(shaKey(repo, pr), exceptSha);
      const raws = await redis.lrange(JOBS_KEY, 0, -1);
      const keep: string[] = [];
      let n = 0;
      for (const raw of raws) {
        const job = parseJob(raw);
        if (isReview(job) && job.repo === repo && job.pr === pr && job.sha !== exceptSha) {
          n += 1;
          continue;
        }
        keep.push(raw);
      }
      await redis.del(JOBS_KEY);
      if (keep.length > 0) await redis.rpush(JOBS_KEY, ...keep);
      return n;
    },
  };
}
