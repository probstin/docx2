/**
 * In-memory per-subject limits for chat: a token bucket (requests per minute) plus a cap on
 * concurrently open streams. State is per-pod; with N replicas the effective limit is
 * roughly N times the configured value (acceptable for the MVP).
 */
export interface ChatLimiterOptions {
  perMinute: number;
  maxConcurrent: number;
  now?: () => number;
}

export type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: "rate" | "concurrency"; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const SWEEP_THRESHOLD = 1000;

export class ChatLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly active = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: ChatLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Take one request token and one stream slot for `subject`, or say why not. */
  acquire(subject: string): AcquireResult {
    const now = this.now();
    if ((this.active.get(subject) ?? 0) >= this.options.maxConcurrent) {
      return { ok: false, reason: "concurrency", retryAfterSeconds: 1 };
    }
    const ratePerMs = this.options.perMinute / 60_000;
    if (this.buckets.size > SWEEP_THRESHOLD) this.sweep(now, ratePerMs);
    const bucket = this.buckets.get(subject) ?? { tokens: this.options.perMinute, updatedAt: now };
    bucket.tokens = Math.min(this.options.perMinute, bucket.tokens + (now - bucket.updatedAt) * ratePerMs);
    bucket.updatedAt = now;
    this.buckets.set(subject, bucket);
    if (bucket.tokens < 1) {
      return {
        ok: false,
        reason: "rate",
        retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / ratePerMs / 1000)),
      };
    }
    bucket.tokens -= 1;
    this.active.set(subject, (this.active.get(subject) ?? 0) + 1);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        const n = (this.active.get(subject) ?? 1) - 1;
        if (n <= 0) this.active.delete(subject);
        else this.active.set(subject, n);
      },
    };
  }

  activeStreams(subject: string): number {
    return this.active.get(subject) ?? 0;
  }

  /** Drop buckets that have refilled completely and have no open streams. */
  private sweep(now: number, ratePerMs: number): void {
    for (const [subject, b] of this.buckets) {
      const full = b.tokens + (now - b.updatedAt) * ratePerMs >= this.options.perMinute;
      if (full && !this.active.has(subject)) this.buckets.delete(subject);
    }
  }
}
