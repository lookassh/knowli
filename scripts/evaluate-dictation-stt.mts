/**
 * Ewaluacja polskiego STT dla dyktowania odpowiedzi szkolnych (Etap 3, design
 * przedmiotów szkolnych §5.1). Narzędzie próby, nie kod produktu: porównuje
 * warianty providerów na tych samych nagraniach i służy kalibracji progu.
 *
 * Silniki porównywane na tych samych bajtach (WAV PCM 16 kHz mono):
 *   A  rest-conversation  produkcyjny adapter `createAzureSttProvider` (locale pl-PL)
 *   B  rest-lexical       ten sam REST short-audio, forma leksykalna NBest[0].Lexical (liczby słownie)
 *   C  fast               Azure Fast Transcription (cały plik, frazy z confidence)
 *   D  fast+phrases       C z listą fraz z materiału (bias — mierzymy też fałszywe trafienia)
 *
 * Tryby:
 *   corepack pnpm eval:dictation-stt synth            (SPIKE_SET=openrouter: Azure A + modele OpenRouter)
 *       syntetyczny polski głos Azure TTS z podniesioną wysokością (przybliżenie
 *       głosu dziecka), pauzy w środku odpowiedzi, liczby, nazwy, cisza i szum.
 *   corepack pnpm eval:dictation-stt live [--port=5180]
 *       lokalna strona http://127.0.0.1:5180 do nagrania odpowiedzi przy urządzeniu.
 *
 * Prywatność: nagrania żyją wyłącznie w pamięci żądania. Skrypt nie zapisuje
 * plików, a konsola trybu live pokazuje tylko statusy, czasy i liczby trafień —
 * transkrypcje widzi wyłącznie strona w przeglądarce prowadzącego próbę.
 * Wymaga AZURE_SPEECH_KEY i AZURE_SPEECH_REGION (synteza i wariant A) oraz
 * UMIEM_GRADER_API_KEY (klucz OpenRouter) dla SPIKE_SET=openrouter w .env.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createAzureSttProvider } from "../packages/server/src/providers/azure/stt";

// ---------- env ----------
{
  let envText = "";
  try {
    envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const line of envText.split(/\r?\n/)) {
    const m = /^(?:export\s+)?([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}
const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
if (!KEY || !REGION) {
  console.error("Brak AZURE_SPEECH_KEY / AZURE_SPEECH_REGION w .env");
  process.exit(1);
}
const LOCALE = "pl-PL";

// ---------- przypadki (fikcyjne odpowiedzi do materiału pilotażowego) ----------
interface Case {
  id: string;
  question: string;
  /** Tekst wypowiedzi; `|n|` = pauza n ms (w synth jako <break/>). */
  spoken: string;
  /** Pojęcia, które grader musi zobaczyć; alternatywy rozdzielone `|`. */
  keys: string[];
  /** Ostatnie pojęcie wypowiedzi — jego brak sugeruje ucięcie po pauzie. */
  tail?: string;
}

const CASES: Case[] = [
  {
    id: "concept-poziomica",
    question: "Co to jest poziomica?",
    spoken: "Poziomica to linia na mapie, która łączy punkty położone na tej samej wysokości.",
    keys: ["poziomic", "lini", "punkt", "tej samej wysoko"],
    tail: "tej samej wysoko",
  },
  {
    id: "number-relative-height",
    question: "Podnóże 150 m n.p.m., szczyt 400 m n.p.m. Jaka jest wysokość względna?",
    spoken: "Wysokość względna wynosi dwieście pięćdziesiąt metrów.",
    keys: ["względn", "250|dwieście pięćdziesiąt", "m|metr"],
  },
  {
    id: "number-scale",
    question: "Ile w terenie to 3 cm w skali 1 : 25 000?",
    spoken: "W skali jeden do dwudziestu pięciu tysięcy trzy centymetry to siedemset pięćdziesiąt metrów.",
    keys: ["25 000|25000|25 tys|dwudziestu pięciu tysięcy", "3|trzy", "750|siedemset pięćdziesiąt"],
    tail: "750|siedemset pięćdziesiąt",
  },
  {
    id: "names-explorers",
    question: "Kto opłynął Ziemię, a kto znalazł drogę morską do Indii?",
    spoken: "Ferdynand Magellan opłynął Ziemię dookoła, a Vasco da Gama znalazł morską drogę do Indii.",
    keys: ["magellan", "vasco|wasko", "gama", "indi"],
    tail: "indi",
  },
  {
    id: "names-polo-cook",
    question: "Dokąd dotarli Marco Polo i James Cook?",
    spoken: "Marco Polo dotarł do Chin, a James Cook zbadał wschodnie wybrzeże Australii.",
    keys: ["marco|marko", "polo", "chin", "cook|kuk", "australi"],
    tail: "australi",
  },
  {
    id: "pause-mid-answer-2s",
    question: "Co to jest mapa?",
    spoken: "Mapa to obraz powierzchni Ziemi |2000| w pomniejszeniu, czyli w skali, |1500| przedstawiony za pomocą znaków umownych.",
    keys: ["mapa", "powierzchni", "pomniejszeni", "skal", "znak", "umown"],
    tail: "umown",
  },
  {
    id: "hesitation-filler",
    question: "Co to jest równik?",
    spoken: "Yyy... równik to |1200| najdłuższy równoleżnik, który dzieli Ziemię na półkulę północną i południową.",
    keys: ["równik", "najdłuższy", "równoleżnik", "półkul", "północn", "południow"],
    tail: "południow",
  },
  {
    id: "long-list-continents",
    question: "Wymień kontynenty od największego.",
    spoken:
      "Kontynenty od największego to Azja, Afryka, |1000| Ameryka Północna, Ameryka Południowa, |1500| Antarktyda, Europa i na końcu Australia.",
    keys: ["azja", "afryka", "ameryka północna", "ameryka południowa", "antarktyd", "europa", "australi"],
    tail: "australi",
  },
  {
    id: "abbrev-npm",
    question: "Co oznacza kolor zielony na mapie hipsometrycznej?",
    spoken: "Zielony kolor oznacza niziny do trzystu metrów nad poziomem morza oraz depresje.",
    keys: ["zielon", "nizin", "300|trzystu", "n.p.m|n. p. m|nad poziomem morza", "depresj"],
    tail: "depresj",
  },
  {
    id: "wrong-answer-paris",
    question: "Przez jakie miasto przechodzi południk 0°?",
    spoken: "Południk zero przechodzi przez Paryż.",
    // błędna odpowiedź: STT ma oddać to, co powiedziano, nie to, co poprawne
    keys: ["południk", "0|zero", "paryż"],
  },
  {
    id: "long-pause-4s",
    question: "Dlaczego poziomice się nie przecinają?",
    spoken: "Poziomice się nie przecinają, |4000| bo punkt nie może leżeć na dwóch wysokościach naraz.",
    keys: ["poziomic", "przecina", "punkt", "dwóch wysoko|dwóch różnych wysoko"],
    tail: "naraz",
  },
];

/** Frazy z materiału rodzica (silnik D); zawierają też pojęcia poprawne, których dziecko nie powiedziało. */
const MATERIAL_PHRASES = [
  "poziomica", "równoleżnik", "równik", "południk", "Magellan", "Vasco da Gama", "Marco Polo", "James Cook",
  "Londyn", "hipsometryczna", "n.p.m.", "Antarktyda", "generalizacja", "Merkator", "siatka kartograficzna",
];

// ---------- normalizacja i metryki ----------
function norm(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[,.;:!?„”"()…–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function hasKey(text: string, key: string): boolean {
  const t = norm(text);
  return key.split("|").some((alt) => {
    const a = norm(alt);
    return a.length > 0 && (a.length <= 2 ? new RegExp(`(^|\\s)${a}(\\s|$)`).test(t) : t.includes(a));
  });
}

// ---------- silniki ----------
interface EngineResult {
  engine: string;
  status: "ok" | "no_speech" | "failed";
  text: string | null;
  confidence: number | null;
  /** Najniższa confidence frazy (Fast Transcription), gdy jest kilka fraz. */
  minPhraseConfidence?: number | null;
  phrases?: number;
  ms: number;
  error?: string;
}

const productionAdapter = createAzureSttProvider({ subscriptionKey: KEY, region: REGION });

async function engineConversation(wav: Uint8Array): Promise<EngineResult> {
  const t0 = performance.now();
  try {
    const r = await productionAdapter.transcribe({ bytes: wav, mimeType: "audio/wav", locale: LOCALE }, AbortSignal.timeout(30_000));
    return { engine: "A rest-conversation", ...r, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    // adapter rzuca przy 401/403; na warstwie F0 zdarza się to też przy limicie wywołań
    return { engine: "A rest-conversation", status: "failed", text: null, confidence: null, ms: Math.round(performance.now() - t0), error: (e as Error).message };
  }
}

async function engineDictation(wav: Uint8Array): Promise<EngineResult> {
  const t0 = performance.now();
  const url =
    `https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
    `?language=${LOCALE}&format=detailed`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": KEY!, "Content-Type": "audio/wav", Accept: "application/json" },
      body: wav,
      signal: AbortSignal.timeout(30_000),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { engine: "B rest-lexical", status: "failed", text: null, confidence: null, ms, error: `HTTP ${res.status}` };
    const p = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string; NBest?: { Confidence?: number; Lexical?: string }[] };
    if (p.RecognitionStatus === "Success") {
      // forma leksykalna: liczby słownie, bez sklejania „25 000” + „3” w „25003”
      return { engine: "B rest-lexical", status: "ok", text: p.NBest?.[0]?.Lexical?.trim() || null, confidence: p.NBest?.[0]?.Confidence ?? null, ms };
    }
    return { engine: "B rest-lexical", status: "no_speech", text: null, confidence: null, ms, error: p.RecognitionStatus };
  } catch (e) {
    return { engine: "B rest-lexical", status: "failed", text: null, confidence: null, ms: Math.round(performance.now() - t0), error: (e as Error).name };
  }
}

async function engineFast(wav: Uint8Array, phrases?: string[]): Promise<EngineResult> {
  const name = phrases ? "D fast+phrases" : "C fast";
  const t0 = performance.now();
  const apiVersion = phrases ? "2025-10-15" : "2024-11-15";
  const url = `https://${REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${apiVersion}`;
  const definition: Record<string, unknown> = { locales: [LOCALE] };
  if (phrases) definition.phraseList = { phrases };
  const form = new FormData();
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "answer.wav");
  form.append("definition", JSON.stringify(definition));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": KEY! },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      // treść błędu usługi nie zawiera audio ani transkrypcji — pokazujemy kod do diagnozy
      const body = (await res.text()).slice(0, 160);
      return { engine: name, status: "failed", text: null, confidence: null, ms, error: `HTTP ${res.status} ${body}` };
    }
    const p = (await res.json()) as {
      combinedPhrases?: { text?: string }[];
      phrases?: { text?: string; confidence?: number; durationMilliseconds?: number }[];
    };
    const text = p.combinedPhrases?.map((c) => c.text ?? "").join(" ").trim() || null;
    const confs = (p.phrases ?? []).map((ph) => ph.confidence).filter((c): c is number => typeof c === "number");
    // średnia ważona długością frazy — jedna liczba porównywalna z A/B
    let weighted: number | null = null;
    if (p.phrases?.length) {
      let sum = 0;
      let dur = 0;
      for (const ph of p.phrases) {
        if (typeof ph.confidence !== "number") continue;
        const d = ph.durationMilliseconds ?? 1;
        sum += ph.confidence * d;
        dur += d;
      }
      weighted = dur > 0 ? sum / dur : null;
    }
    return {
      engine: name,
      status: text ? "ok" : "no_speech",
      text,
      confidence: weighted,
      minPhraseConfidence: confs.length ? Math.min(...confs) : null,
      phrases: p.phrases?.length ?? 0,
      ms,
    };
  } catch (e) {
    return { engine: name, status: "failed", text: null, confidence: null, ms: Math.round(performance.now() - t0), error: (e as Error).name };
  }
}

// ---------- OpenRouter /audio/transcriptions (klucz gradera; ZDR, bez zbierania danych) ----------
const OR_KEY = process.env.UMIEM_GRADER_API_KEY;
const OR_MODELS = (process.env.SPIKE_OR_MODELS ??
  "google/gemini-3.5-transcribe,openai/gpt-transcribe,elevenlabs/scribe-v2,mistralai/voxtral-small-transcribe-3-0,openai/whisper-large-v3,assemblyai/universal-3-6-pro")
  .split(",").filter(Boolean);

async function engineOpenRouter(wav: Uint8Array, model: string): Promise<EngineResult> {
  const name = `OR ${model.split("/")[1]}`;
  const t0 = performance.now();
  const call = async (responseFormat: "verbose_json" | "json") => fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input_audio: { data: Buffer.from(wav).toString("base64"), format: "wav" },
      language: "pl",
      temperature: 0,
      response_format: responseFormat,
      ...(responseFormat === "verbose_json" ? { timestamp_granularities: ["word", "segment"] } : {}),
      provider: process.env.SPIKE_OR_ZDR === "0" ? { data_collection: "deny" } : { zdr: true, data_collection: "deny" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  try {
    let res = await call("verbose_json");
    if (res.status === 400) res = await call("json");
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) return { engine: name, status: "failed", text: null, confidence: null, ms, error: `HTTP ${res.status} ${(await res.text()).slice(0, 140)}` };
    const p = (await res.json()) as {
      text?: string; confidence?: number;
      words?: { confidence?: number }[];
      segments?: { avg_logprob?: number; no_speech_prob?: number }[];
      usage?: { cost?: number };
    };
    const text = p.text?.trim() || null;
    const wordConfs = (p.words ?? []).map((w) => w.confidence).filter((c): c is number => typeof c === "number");
    const segLogprob = (p.segments ?? []).map((s) => s.avg_logprob).filter((c): c is number => typeof c === "number");
    const noSpeech = (p.segments ?? []).map((s) => s.no_speech_prob).filter((c): c is number => typeof c === "number");
    const confidence = typeof p.confidence === "number"
      ? p.confidence
      : wordConfs.length ? wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length
        : segLogprob.length ? Math.exp(segLogprob.reduce((a, b) => a + b, 0) / segLogprob.length) : null;
    return {
      engine: name, status: text ? "ok" : "no_speech", text, confidence,
      minPhraseConfidence: wordConfs.length ? Math.min(...wordConfs) : noSpeech.length ? Math.max(...noSpeech) : null,
      ms, error: p.usage?.cost !== undefined ? `$${p.usage.cost.toFixed(5)}` : undefined,
    };
  } catch (e) {
    return { engine: name, status: "failed", text: null, confidence: null, ms: Math.round(performance.now() - t0), error: (e as Error).name };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function runEngines(wav: Uint8Array): Promise<EngineResult[]> {
  if (process.env.SPIKE_SET === "openrouter") {
    // Azure A jako punkt odniesienia + modele OpenRouter równolegle
    await sleep(1500);
    if (process.env.SPIKE_SKIP_AZURE === "1") return Promise.all(OR_MODELS.map((m) => engineOpenRouter(wav, m)));
    const [a, ...rest] = await Promise.all([engineConversation(wav), ...OR_MODELS.map((m) => engineOpenRouter(wav, m))]);
    return [a!, ...rest];
  }
  // Fast Transcription ma niski limit wywołań na minutę — C i D sekwencyjnie z odstępem
  const gap = Number(process.env.SPIKE_FAST_GAP_MS ?? 4000);
  const a = await engineConversation(wav);
  await sleep(gap / 2);
  const b = await engineDictation(wav);
  await sleep(Number(process.env.SPIKE_FAST_GAP_MS ?? 4000));
  const c = await engineFast(wav);
  await sleep(Number(process.env.SPIKE_FAST_GAP_MS ?? 4000));
  const d = await engineFast(wav, MATERIAL_PHRASES);
  return [a, b, c, d];
}

interface Scored extends EngineResult {
  keyHits: number;
  keyTotal: number;
  missingKeys: string[];
  truncated: boolean | null;
}
function score(r: EngineResult, c: Case | undefined): Scored {
  if (!c) return { ...r, keyHits: 0, keyTotal: 0, missingKeys: [], truncated: null };
  const text = r.text ?? "";
  const missing = c.keys.filter((k) => !hasKey(text, k));
  return {
    ...r,
    keyHits: c.keys.length - missing.length,
    keyTotal: c.keys.length,
    missingKeys: missing,
    truncated: c.tail ? r.status === "ok" && !hasKey(text, c.tail) : null,
  };
}

// ---------- synteza (Azure TTS, ten sam klucz) ----------
const VOICES = ["pl-PL-ZofiaNeural", "pl-PL-MarekNeural", "pl-PL-AgnieszkaNeural"];

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function ssml(voice: string, spoken: string, childish: boolean): string {
  const body = spoken
    .split(/\|(\d+)\|/)
    .map((part, i) => (i % 2 === 1 ? `<break time="${part}ms"/>` : escapeXml(part)))
    .join("");
  const inner = childish ? `<prosody pitch="+35%" rate="-12%">${body}</prosody>` : body;
  return `<speak version="1.0" xml:lang="pl-PL"><voice name="${voice}">${inner}</voice></speak>`;
}
async function tts(voice: string, spoken: string, childish: boolean): Promise<Uint8Array> {
  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY!,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "riff-16khz-16bit-mono-pcm",
      "User-Agent": "umiem-spike",
    },
    body: ssml(voice, spoken, childish),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
function wavFromSamples(samples: Float32Array, sampleRate = 16_000): Uint8Array {
  const data = samples.length * 2;
  const wav = new Uint8Array(44 + data);
  const v = new DataView(wav.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  ascii(0, "RIFF"); v.setUint32(4, 36 + data, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, "data"); v.setUint32(40, data, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return wav;
}
function wavSeconds(wav: Uint8Array): number {
  return (wav.length - 44) / 32_000;
}

function fmtConf(c: number | null | undefined): string {
  return c === null || c === undefined ? "  –  " : c.toFixed(2).padStart(5);
}

async function synth(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith("--voices="))?.slice(9).split(",");
  const voices = only ?? VOICES;
  const rows: { caseId: string; voice: string; seconds: number; results: Scored[] }[] = [];
  for (const c of CASES) {
    for (const voice of voices) {
      for (const childish of [true]) {
        const wav = await tts(voice, c.spoken, childish);
        const results = (await runEngines(wav)).map((r) => score(r, c));
        rows.push({ caseId: c.id, voice: `${voice.replace("pl-PL-", "").replace("Neural", "")}${childish ? "+child" : ""}`, seconds: wavSeconds(wav), results });
        console.log(`\n# ${c.id} | ${rows.at(-1)!.voice} | ${wavSeconds(wav).toFixed(1)} s`);
        for (const r of results) {
          console.log(
            `  ${r.engine.padEnd(20)} ${r.status.padEnd(9)} conf ${fmtConf(r.confidence)} min ${fmtConf(r.minPhraseConfidence)} ` +
              `keys ${r.keyHits}/${r.keyTotal}${r.truncated ? " UCIĘTE" : ""} ${String(r.ms).padStart(5)} ms  ${r.error ?? ""}`,
          );
          console.log(`      „${r.text ?? ""}”${r.missingKeys.length ? `  brak: ${r.missingKeys.join(", ")}` : ""}`);
        }
      }
    }
  }
  // cisza i szum — każdy silnik musi dać no_speech/pusty tekst, nie treść
  const silence = wavFromSamples(new Float32Array(16_000 * 3));
  const noise = wavFromSamples(Float32Array.from({ length: 16_000 * 3 }, () => (Math.random() * 2 - 1) * 0.15));
  for (const [id, wav] of [["silence-3s", silence], ["noise-3s", noise]] as const) {
    const results = (await runEngines(wav)).map((r) => score(r, undefined));
    console.log(`\n# ${id}`);
    for (const r of results) console.log(`  ${r.engine.padEnd(20)} ${r.status.padEnd(9)} conf ${fmtConf(r.confidence)} „${r.text ?? ""}” ${r.error ?? ""}`);
    rows.push({ caseId: id, voice: "-", seconds: 3, results });
  }

  // podsumowanie per silnik
  console.log("\n=== Podsumowanie (przypadki z mową) ===");
  const engines = rows[0]!.results.map((r) => r.engine);
  for (const engine of engines) {
    const speech = rows.filter((r) => r.voice !== "-").map((r) => r.results.find((x) => x.engine === engine)!);
    const hits = speech.reduce((s, r) => s + r.keyHits, 0);
    const total = speech.reduce((s, r) => s + r.keyTotal, 0);
    const truncated = speech.filter((r) => r.truncated).length;
    const failed = speech.filter((r) => r.status !== "ok").length;
    const confs = speech.map((r) => r.confidence).filter((c): c is number => c !== null);
    const ms = speech.map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `${engine.padEnd(20)} pojęcia ${hits}/${total} (${((100 * hits) / total).toFixed(0)}%), ucięte ${truncated}, bez wyniku ${failed}, ` +
        `conf min ${Math.min(...confs).toFixed(2)} med ${confs.sort()[Math.floor(confs.length / 2)]?.toFixed(2)}, ` +
        `czas med ${ms[Math.floor(ms.length / 2)]} ms max ${ms.at(-1)} ms`,
    );
  }
}

// ---------- tryb live ----------
const MAX_LIVE_SECONDS = 60;
const MAX_LIVE_BYTES = 2_100_000;

function livePage(): string {
  const cases = JSON.stringify(CASES.map(({ id, question, keys }) => ({ id, question, keys })));
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spike STT pl-PL</title>
<style>body{font:16px system-ui;margin:16px;max-width:900px}button{font:inherit;padding:12px 18px;margin:4px;min-height:48px}
table{border-collapse:collapse;width:100%;margin-top:8px}td,th{border:1px solid #ccc;padding:4px 6px;font-size:14px;vertical-align:top}
.rec{background:#c62828;color:#fff}.miss{color:#c62828}.q{font-size:20px;font-weight:600;margin:12px 0}</style></head><body>
<h1>Próba polskiego STT (nic nie jest zapisywane)</h1>
<p>Wybierz pytanie, naciśnij „Nagrywaj”, odpowiedz własnymi słowami (pauzy i „yyy” są OK), potem „Stop”. Limit ${MAX_LIVE_SECONDS} s.
Nagranie trafia tylko do pamięci lokalnego skryptu i dalej do Azure; wyniki widać tylko tutaj.</p>
<label>Pytanie: <select id="case"></select></label> <label><input type="checkbox" id="free"> swobodna wypowiedź (bez pytania)</label>
<div class="q" id="question"></div>
<button id="rec">Nagrywaj</button><button id="stop" disabled>Stop</button> <span id="status"></span>
<div id="out"></div>
<script>
const CASES=${cases};
const sel=document.getElementById('case');CASES.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.id;sel.append(o)});
const q=document.getElementById('question');const show=()=>{q.textContent=CASES.find(c=>c.id===sel.value).question};sel.onchange=show;show();
let rec,stream,chunks=[],timer,t0;
const status=s=>document.getElementById('status').textContent=s;
document.getElementById('rec').onclick=async()=>{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  chunks=[];rec=new MediaRecorder(stream);rec.ondataavailable=e=>chunks.push(e.data);
  rec.onstop=send;rec.start();t0=Date.now();
  document.getElementById('rec').disabled=true;document.getElementById('rec').classList.add('rec');document.getElementById('stop').disabled=false;
  timer=setInterval(()=>{const s=(Date.now()-t0)/1000;status('nagrywanie '+s.toFixed(0)+' s');if(s>=${MAX_LIVE_SECONDS})stop()},250);
};
function stop(){clearInterval(timer);if(rec&&rec.state!=='inactive')rec.stop();stream&&stream.getTracks().forEach(t=>t.stop());
  document.getElementById('rec').disabled=false;document.getElementById('rec').classList.remove('rec');document.getElementById('stop').disabled=true;}
document.getElementById('stop').onclick=stop;
async function toWav(blob){const ctx=new AudioContext();try{const d=await ctx.decodeAudioData(await blob.arrayBuffer());
  const sr=16000,n=Math.ceil(d.duration*sr),off=new OfflineAudioContext(1,n,sr),src=off.createBufferSource();src.buffer=d;src.connect(off.destination);src.start(0);
  const s=(await off.startRendering()).getChannelData(0),b=new ArrayBuffer(44+s.length*2),v=new DataView(b),w=(o,t)=>[...t].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));
  w(0,'RIFF');v.setUint32(4,36+s.length*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,s.length*2,true);
  for(let i=0;i<s.length;i++){const x=Math.max(-1,Math.min(1,s[i]));v.setInt16(44+i*2,x<0?x*0x8000:x*0x7fff,true)}return {wav:b,seconds:d.duration}}finally{ctx.close()}}
async function send(){status('analiza…');let wav,seconds;({wav,seconds}=await toWav(new Blob(chunks)));chunks=[];
  const caseId=document.getElementById('free').checked?'':sel.value;
  const res=await fetch('/analyze',{method:'POST',headers:{'content-type':'audio/wav','x-case-id':caseId},body:wav});wav=null;
  const data=await res.json();status('gotowe ('+seconds.toFixed(1)+' s nagrania)');
  const rows=data.results.map(r=>'<tr><td>'+r.engine+'</td><td>'+r.status+(r.error?' '+r.error:'')+'</td><td>'+(r.confidence==null?'–':r.confidence.toFixed(2))+(r.minPhraseConfidence!=null?' / min '+r.minPhraseConfidence.toFixed(2):'')+'</td><td>'+(r.keyTotal?r.keyHits+'/'+r.keyTotal+(r.truncated?' UCIĘTE':''):'–')+'</td><td>'+r.ms+' ms</td><td>'+(r.text||'')+(r.missingKeys.length?'<div class=miss>brak: '+r.missingKeys.join(', ')+'</div>':'')+'</td></tr>').join('');
  document.getElementById('out').insertAdjacentHTML('afterbegin','<h3>'+(caseId||'swobodna')+' — '+seconds.toFixed(1)+' s</h3><table><tr><th>silnik</th><th>status</th><th>conf</th><th>pojęcia</th><th>czas</th><th>transkrypcja</th></tr>'+rows+'</table>');}
</script></body></html>`;
}

function live(): void {
  const port = Number(process.argv.find((a) => a.startsWith("--port="))?.slice(7) ?? 5180);
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(livePage());
      return;
    }
    if (req.method === "POST" && req.url === "/analyze") {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_LIVE_BYTES) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      let wav: Uint8Array | null = new Uint8Array(Buffer.concat(chunks));
      chunks.length = 0;
      const caseId = String(req.headers["x-case-id"] ?? "");
      const c = CASES.find((x) => x.id === caseId);
      const seconds = wavSeconds(wav);
      const results = (await runEngines(wav)).map((r) => score(r, c));
      wav = null; // bajty nagrania nie żyją dłużej niż żądanie
      // konsola: wyłącznie metadane — bez transkrypcji i bez bajtów
      console.log(
        `[live] ${caseId || "swobodna"} ${seconds.toFixed(1)} s | ` +
          results.map((r) => `${r.engine.split(" ")[0]}:${r.status}${r.keyTotal ? ` ${r.keyHits}/${r.keyTotal}` : ""}${r.truncated ? "!" : ""} ${r.ms}ms`).join(" | "),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Spike live: http://127.0.0.1:${port}  (Ctrl+C kończy; nic nie jest zapisywane)`);
  });
}

const mode = process.argv[2];
if (mode === "synth") await synth();
else if (mode === "live") live();
else {
  console.error("Użycie: evaluate-dictation-stt.mts synth [--voices=pl-PL-ZofiaNeural,...] | live [--port=5180]");
  process.exit(1);
}
