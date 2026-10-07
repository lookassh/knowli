import type { Database } from "./db/client";

/** Zegar jako zależność — domena i moduły nie wołają Date.now() bezpośrednio. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Zależności serwowe przekazywane do przypadków użycia. Rosną wraz z zadaniami
 * (providers, media, policyRegistry dojdą w zadaniach 3+).
 */
export interface Services {
  db: Database;
  clock: Clock;
}

export function createServices(input: { db: Database; clock?: Clock }): Services {
  return { db: input.db, clock: input.clock ?? systemClock };
}
