import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// #399: obrona w głąb bez pełnego CSP — nosniff globalnie (w tym panel i media)
// oraz frame-ancestors 'none' na odpowiedziach aplikacji (w tym panelu rodzica).
describe("next.config headers (#399)", () => {
  it("każda trasa dostaje nosniff i frame-ancestors 'none'", async () => {
    const entries = (await nextConfig.headers?.()) ?? [];

    const global = entries.find((entry) => entry.source === "/:path*");
    expect(global, "brak globalnego wpisu headers dla /:path*").toBeDefined();
    const byKey = new Map((global?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey.get("x-content-type-options")).toBe("nosniff");
    expect(byKey.get("content-security-policy")).toBe("frame-ancestors 'none'");
  });
});
