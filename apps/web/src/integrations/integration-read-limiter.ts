import { AppError, type IntegrationPrincipal } from "@learning/server";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

export class IntegrationReadLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  constructor(private readonly maxRequests = MAX_REQUESTS) {}

  consume(principal: IntegrationPrincipal, now = Date.now()): void {
    const bucket = this.buckets.get(principal.id);
    if (!bucket || now - bucket.start >= WINDOW_MS) {
      this.buckets.set(principal.id, { start: now, count: 1 });
      return;
    }
    if (bucket.count >= this.maxRequests) throw new AppError("rate_limited");
    bucket.count += 1;
  }

  retryAfterSeconds(principal: IntegrationPrincipal, now = Date.now()): number {
    const bucket = this.buckets.get(principal.id);
    return bucket ? Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000)) : 1;
  }
}

export const learningOverviewLimiter = new IntegrationReadLimiter();
