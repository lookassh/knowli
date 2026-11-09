import { AppError, type IntegrationPrincipal } from "@learning/server";
import { LESSON_AUTHORING_WRITES_PER_HOUR } from "@learning/contracts";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

export class IntegrationReadLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  constructor(private readonly maxRequests = MAX_REQUESTS, private readonly windowMs = WINDOW_MS) {}

  consume(principal: IntegrationPrincipal, now = Date.now()): void {
    this.assertAvailable(principal, now);
    this.record(principal, now);
  }

  /** `rate_limited`, gdy okno tokenu jest wyczerpane; niczego nie liczy. */
  assertAvailable(principal: IntegrationPrincipal, now = Date.now()): void {
    const bucket = this.buckets.get(principal.id);
    if (bucket && now - bucket.start < this.windowMs && bucket.count >= this.maxRequests) throw new AppError("rate_limited");
  }

  /** Liczy jedno użycie bez sprawdzania limitu (zapis, który już się udał). */
  record(principal: IntegrationPrincipal, now = Date.now()): void {
    const bucket = this.buckets.get(principal.id);
    if (!bucket || now - bucket.start >= this.windowMs) this.buckets.set(principal.id, { start: now, count: 1 });
    else bucket.count += 1;
  }

  retryAfterSeconds(principal: IntegrationPrincipal, now = Date.now()): number {
    const bucket = this.buckets.get(principal.id);
    return bucket ? Math.max(1, Math.ceil((bucket.start + this.windowMs - now) / 1000)) : 1;
  }
}

export const learningOverviewLimiter = new IntegrationReadLimiter();
/** Zapisy lekcji przez MCP (każdy zleca płatne nagrania TTS): osobny limit na token, oprócz limitu żądań. */
export const lessonWriteLimiter = new IntegrationReadLimiter(LESSON_AUTHORING_WRITES_PER_HOUR, 60 * 60_000);
