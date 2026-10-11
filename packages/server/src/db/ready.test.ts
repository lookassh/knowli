import { describe, expect, it } from "vitest";
import { waitUntilDatabaseReady } from "./ready";

/**
 * Gotowość Postgresa dla testów mierzymy realnym handshake'em (connect + SELECT 1)
 * po dokładnie tym URL-u, którego użyti migracje — nie sygnałem z wnętrza kontenera.
 * Regression: pg_isready po unix sockecie zielieje podczas startu tymczasowego
 * serwera entrypointa (listen_addresses=''), gdy port TCP jeszcze nie słucha,
 * a na linuksowym CI port-proxy oddaje wtedy ECONNRESET (tryb A flaków CI).
 */
describe("waitUntilDatabaseReady", () => {
  it("polluje probe aż handshake się powiedzie i wtedy rozwiązuje", async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      if (calls < 3) throw new Error("read ECONNRESET");
    };
    await waitUntilDatabaseReady("postgres://ready-test", { probe, intervalMs: 5, timeoutMs: 1_000 });
    expect(calls).toBe(3);
  });

  it("przekazuje probe dokładnie ten connection string, którego użyje migracja", async () => {
    const seen: string[] = [];
    await waitUntilDatabaseReady("postgres://ready-test-arg", {
      probe: async (url) => { seen.push(url); },
      intervalMs: 5,
      timeoutMs: 1_000,
    });
    expect(seen).toEqual(["postgres://ready-test-arg"]);
  });

  it("rzeka czytelnym błędem z ostatnią przyczyną po wyczerpaniu limitu czasu", async () => {
    await expect(
      waitUntilDatabaseReady("postgres://ready-test-timeout", {
        probe: async () => { throw new Error("read ECONNRESET"); },
        intervalMs: 5,
        timeoutMs: 30,
      }),
    ).rejects.toThrow(/ready-test-timeout.*ECONNRESET/s);
  });

  it("kończy się szybko po pierwszym udanym probe (nie dojada interwału)", async () => {
    const startedAt = Date.now();
    await waitUntilDatabaseReady("postgres://ready-test-fast", { probe: async () => undefined, intervalMs: 500, timeoutMs: 5_000 });
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});
