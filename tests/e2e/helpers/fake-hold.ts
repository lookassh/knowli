import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readTestRunConfig } from "../../test-run-config";

/**
 * Bramka fake providerów świata E2E (`UMIEM_FAKE_HOLD_FILE`, `waitWhileFakeHeld`
 * w packages/server/src/providers/fake.ts): dopóki plik istnieje, worker świata
 * wstrzymuje fake'owe generowanie zestawu, TTS i obrazów.
 *
 * Fake'i nie mają w E2E sztucznego opóźnienia, więc spec, który sprawdza
 * przejściowy stan „generowanie”, wstrzymuje je przed akcją i zwalnia po
 * asercji. Bramka obejmuje cały świat, a projekt `real` ma w świecie jeden
 * worker Playwrighta — wstrzymanie nie dotyka innych testów. Spec używający
 * bramki rejestruje `test.afterEach(releaseFakeGeneration)`, żeby porażka
 * w środku testu nie zostawiła jej zamkniętej.
 */
function holdFile(): string {
  return join(process.cwd(), readTestRunConfig(process.env).fakeHoldFile);
}

export async function holdFakeGeneration(): Promise<void> {
  await writeFile(holdFile(), "");
}

export async function releaseFakeGeneration(): Promise<void> {
  await rm(holdFile(), { force: true });
}
