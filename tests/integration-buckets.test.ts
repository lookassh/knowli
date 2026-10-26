import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCiJobBuckets } from "./ci-matrix";
import { INTEGRATION_BUCKETS, INTEGRATION_SPECS } from "./integration-buckets";

const INTEGRATION_DIR = join(process.cwd(), "tests/integration");

describe("kosze testów integracyjnych (integration-buckets)", () => {
  it("każdy plik *.test.ts należy do dokładnie jednego kosza", () => {
    // Rekurencyjnie: plik w podkatalogu też musi trafić do kosza, inaczej
    // żaden job CI by go nie uruchomił, a test przeszedłby zielono.
    const onDisk = readdirSync(INTEGRATION_DIR, { recursive: true })
      .map((name) => `tests/integration/${String(name).replaceAll("\\", "/")}`)
      .filter((name) => name.endsWith(".test.ts"))
      .sort();
    expect([...INTEGRATION_SPECS].sort()).toEqual(onDisk);
    expect(new Set(INTEGRATION_SPECS).size).toBe(INTEGRATION_SPECS.length);
    for (const bucket of INTEGRATION_BUCKETS) {
      expect(bucket.length).toBeGreaterThan(0);
    }
  });

  it("matrix CI obejmuje dokładnie kosze INTEGRATION_BUCKETS", () => {
    expect(readCiJobBuckets("integration")).toEqual(INTEGRATION_BUCKETS.map((_, i) => i + 1));
  });
});
