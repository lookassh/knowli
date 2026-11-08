import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kontrakt deploy/compose.yaml (#408): wszystkie usługi mają limit i rotację
 * logów (json-file), a web i worker mają 60 s na uporządkowane zamknięcie.
 * Bez parsera YAML w zależnościach: test dzieli plik na bloki usług po wcięciu.
 */

const compose = readFileSync(join(__dirname, "..", "deploy", "compose.yaml"), "utf8");

/** Blok usługi od wiersza `  <nazwa>:` do następnej usługi lub końca sekcji. */
function serviceBlock(name: string): string {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `usługa ${name} w compose.yaml`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const SERVICES = ["db", "migrate", "web", "worker"];

describe("deploy/compose.yaml (#408)", () => {
  it("definiuje wspólną kotwicę logging z limitem rozmiaru i liczbą plików", () => {
    expect(compose).toMatch(/x-logging:\s*&default-logging/);
    expect(compose).toMatch(/driver:\s*json-file/);
    expect(compose).toMatch(/max-size:\s*"10m"/);
    expect(compose).toMatch(/max-file:\s*"5"/);
  });

  it.each(SERVICES)("usługa %s używa wspólnego loggingu", (service) => {
    expect(serviceBlock(service)).toMatch(/(?:^|\n)\s*logging:\s*\*default-logging/);
  });

  it.each(["web", "worker"])("usługa %s ma stop_grace_period 60s", (service) => {
    expect(serviceBlock(service)).toMatch(/(?:^|\n)\s*stop_grace_period:\s*60s/);
  });

  it("db nie ma wymuszonego stop_grace_period", () => {
    expect(serviceBlock("db")).not.toMatch(/stop_grace_period/);
  });
});
