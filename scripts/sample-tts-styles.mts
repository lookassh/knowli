/**
 * Próbki do odsłuchu stylów wypowiedzi TTS (spec tonu TTS §3.6, etap A).
 *
 * Uruchomienie:
 *   corepack pnpm eval:tts-styles -- --out <katalog poza repozytorium>
 *   UMIEM_FAKE_PROVIDERS=1 corepack pnpm eval:tts-styles -- --out <katalog>   # sanity pipeline'u (bajty fake)
 *
 * Generuje z bieżącą konfiguracją (.env: UMIEM_TTS_*, w tym UMIEM_TTS_STYLE) 17 komunikatów Kid UI oraz po jednym
 * przykładowym pytaniu i karcie lekcji (stałe teksty poniżej) i zapisuje `<rola>-<klucz>.wav|mp3` oraz `index.txt`
 * (plik, rola, głos, tekst, instrukcja). Narzędzie próby: nie dotyka bazy ani mediów aplikacji, a katalog wyjściowy
 * musi leżeć poza repozytorium (próbki nie są częścią kodu). Do usługi TTS trafiają wyłącznie stałe teksty
 * interfejsu i przykładowe teksty z tego pliku — bez danych dziecka. Klucze nie są wypisywane.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { mediaSettingsFromEnv, ttsVoiceFor } from "../packages/server/src/config";
import { UI_AUDIO_STYLES, UI_AUDIO_TEXTS } from "../packages/server/src/domain/ui-audio-catalog";
import type { TtsStyle } from "../packages/server/src/domain/tts-style";
import { createGenerationDepsFromEnv } from "../packages/server/src/providers/generation-env";
import { ttsRequestInstructions } from "../packages/server/src/providers/tts-style-profile";

const LOCALE = "pl-PL";

/** Stałe przykładowe teksty ról lekcji (fikcyjne, bez danych dziecka). */
const LESSON_SAMPLES: { style: "lesson_question" | "lesson_card"; key: string; text: string }[] = [
  { style: "lesson_question", key: "przyklad", text: "Dlaczego liście są zielone? Odpowiedz jednym zdaniem." },
  {
    style: "lesson_card",
    key: "przyklad",
    text: "Fotosynteza. Rośliny wytwarzają pokarm dzięki światłu słonecznemu. Liście pobierają światło, wodę i powietrze.",
  },
];

function argValue(name: string): string | undefined {
  const prefixed = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// .env jest opcjonalny (zmienne mogą pochodzić ze środowiska); istniejące zmienne środowiska mają pierwszeństwo.
{
  let envText = "";
  try {
    envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of envText.split(/\r?\n/)) {
    const m = /^(?:export\s+)?([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

const outArg = argValue("out");
if (!outArg) {
  console.error("Użycie: pnpm eval:tts-styles -- --out <katalog poza repozytorium>");
  process.exit(2);
}
const outDir = resolve(outArg);
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (gitRoot.status !== 0) {
  console.error("Nie udało się ustalić katalogu głównego repozytorium (git rev-parse --show-toplevel).");
  process.exit(2);
}
const repoRoot = resolve(gitRoot.stdout.trim());
const fromRepo = relative(repoRoot, outDir);
if (fromRepo === "" || (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))) {
  console.error(`Odmowa: katalog wyjściowy leży w repozytorium (${repoRoot}). Wskaż katalog poza repozytorium.`);
  process.exit(2);
}

const settings = mediaSettingsFromEnv(process.env);
const deps = createGenerationDepsFromEnv(process.env);
if (!deps) {
  console.error("Brak konfiguracji TTS (klucz w .env). Użyj UMIEM_FAKE_PROVIDERS=1 do sanity checku.");
  process.exit(2);
}
const tts = deps.tts;
const voice = ttsVoiceFor(settings.tts, LOCALE);
const extension = settings.tts.format;

mkdirSync(outDir, { recursive: true });

interface Sample {
  file: string;
  style: TtsStyle;
  text: string;
}
const samples: Sample[] = [
  ...(Object.keys(UI_AUDIO_TEXTS) as (keyof typeof UI_AUDIO_TEXTS)[]).map((key) => ({
    file: `${UI_AUDIO_STYLES[key]}-${key}.${extension}`,
    style: UI_AUDIO_STYLES[key] as TtsStyle,
    text: UI_AUDIO_TEXTS[key],
  })),
  ...LESSON_SAMPLES.map((sample) => ({
    file: `${sample.style}-${sample.key}.${extension}`,
    style: sample.style as TtsStyle,
    text: sample.text,
  })),
];

console.log(
  `provider=${settings.tts.provider} model=${settings.tts.model} głos=${voice} format=${extension} ` +
    `styl=${settings.tts.style ?? "none"} próbki=${samples.length} katalog=${outDir}`,
);

const index: string[] = [];
let failed = 0;
for (const sample of samples) {
  const instructions = ttsRequestInstructions(settings.tts, LOCALE, sample.style);
  try {
    const result = await tts.synthesize(
      {
        text: sample.text,
        locale: LOCALE,
        voice,
        format: settings.tts.format,
        model: settings.tts.model,
        ...(instructions === undefined ? {} : { instructions }),
      },
      AbortSignal.timeout(60_000),
    );
    writeFileSync(join(outDir, sample.file), result.bytes);
    index.push(
      [
        `plik: ${sample.file}`,
        `rola: ${sample.style}`,
        `głos: ${voice}`,
        `tekst: ${sample.text}`,
        `instrukcja: ${instructions ?? "(brak)"}`,
        "",
      ].join("\n"),
    );
    console.log(`ok ${sample.file} (${result.bytes.byteLength} B)`);
  } catch (error) {
    failed += 1;
    console.error(`błąd ${sample.file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
writeFileSync(join(outDir, "index.txt"), index.join("\n"), "utf8");
console.log(`zapisano ${samples.length - failed}/${samples.length} próbek, index.txt w ${outDir}`);
process.exit(failed === 0 ? 0 : 1);
