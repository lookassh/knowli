import { describe, expect, it } from "vitest";
import { DEFAULT_LESSON_STT_MODEL, defaultMediaSettings, graderFromEnv, lessonSpeechFromEnv, mediaSettingsFromEnv, sessionActivityFromEnv, ttsVoiceFor } from "./config";

describe("mediaSettingsFromEnv", () => {
  it("bez env zwraca domyślne ustawienia (low + webp)", () => {
    expect(mediaSettingsFromEnv({})).toEqual(defaultMediaSettings);
    expect(defaultMediaSettings.image).toMatchObject({ quality: "low", format: "webp" });
    expect(defaultMediaSettings.image.model).toBe("gpt-image-2.5-sunburst");
  });

  it("puste UMIEM_TTS_* jak nieustawione — fingerprint opisuje model faktycznie użyty przez adapter", () => {
    expect(mediaSettingsFromEnv({ UMIEM_TTS_PROVIDER: "", UMIEM_TTS_MODEL: "", UMIEM_TTS_VOICE: "" }).tts).toEqual(defaultMediaSettings.tts);
    expect(mediaSettingsFromEnv({ UMIEM_TTS_PROVIDER: "openrouter", UMIEM_TTS_MODEL: "openai/gpt-4o-mini-tts-2025-12-15" }).tts)
      .toMatchObject({ provider: "openrouter", model: "openai/gpt-4o-mini-tts-2025-12-15", voice: "alloy" });
  });

  it("UMIEM_TTS_VOICE_<LANG>_<REGION> przypisuje głos do locale; reszta używa UMIEM_TTS_VOICE", () => {
    const settings = mediaSettingsFromEnv({
      UMIEM_TTS_VOICE: "pl-PL-Harper:MAI-Voice-2.1-Flash",
      UMIEM_TTS_VOICE_EN_GB: "en-GB-Harry:MAI-Voice-2.1-Flash",
      UMIEM_TTS_VOICE_DE_DE: "",
    });
    expect(settings.tts.voices).toEqual({ "en-GB": "en-GB-Harry:MAI-Voice-2.1-Flash" });
    expect(ttsVoiceFor(settings.tts, "en-GB")).toBe("en-GB-Harry:MAI-Voice-2.1-Flash");
    expect(ttsVoiceFor(settings.tts, "pl-PL")).toBe("pl-PL-Harper:MAI-Voice-2.1-Flash");
    // bez zmiennych per locale ustawienia (i fingerprinty) jak dotąd
    expect(mediaSettingsFromEnv({}).tts).not.toHaveProperty("voices");
  });

  it("zmienne UMIEM_IMAGE_* nadpisują model, rozmiar, jakość i format", () => {
    const settings = mediaSettingsFromEnv({
      UMIEM_IMAGE_MODEL: "gpt-image-1-mini",
      UMIEM_IMAGE_SIZE: "1024x1536",
      UMIEM_IMAGE_QUALITY: "medium",
      UMIEM_IMAGE_FORMAT: "png",
    });
    expect(settings.image).toEqual({
      provider: "openai",
      model: "gpt-image-1-mini",
      size: "1024x1536",
      quality: "medium",
      format: "png",
    });
    expect(settings.tts).toEqual(defaultMediaSettings.tts);
  });
});


describe("graderFromEnv", () => {
  const base = {
    UMIEM_GRADER_BASE_URL: "https://grader.example/v1",
    UMIEM_GRADER_API_KEY: "secret",
    UMIEM_GRADER_MODEL: "cheap-1",
  };

  it("bez konfiguracji → undefined (model wyłączony to stan poprawny)", () => {
    expect(graderFromEnv({})).toBeUndefined();
  });

  it("komplet trzech wartości → skonfigurowany grader z domyślnymi limitami", () => {
    const grader = graderFromEnv({ ...base });
    expect(grader).toBeDefined();
    expect(grader!.provider.model).toBe("cheap-1");
    expect(grader!.maxCallsPerSession).toBe(20);
    expect(grader!.timeoutMs).toBe(8000);
  });

  it("błędna opcja pośrednika (UMIEM_GRADER_REASONING) zatrzymuje start zamiast cicho ją pominąć", () => {
    expect(() => graderFromEnv({ ...base, UMIEM_GRADER_REASONING: "turbo" })).toThrow(/UMIEM_GRADER_REASONING/);
    expect(() => sessionActivityFromEnv({ ...base, UMIEM_GRADER_PROVIDER_DATA_COLLECTION: "maybe" })).toThrow(/DATA_COLLECTION/);
    const openRouter = { ...base, UMIEM_GRADER_BASE_URL: "https://openrouter.ai/api/v1" };
    expect(graderFromEnv({ ...openRouter, UMIEM_GRADER_REASONING: "low", UMIEM_GRADER_PROVIDER_DATA_COLLECTION: "deny" })).toBeDefined();
    // Opcje OpenRouter dla innego endpointu też zatrzymują start (grader i ocena aktywności).
    expect(() => graderFromEnv({ ...base, UMIEM_GRADER_PROVIDER_DATA_COLLECTION: "deny" })).toThrow(/openrouter/);
    expect(() => sessionActivityFromEnv({ ...base, UMIEM_GRADER_REASONING: "off" })).toThrow(/openrouter/);
  });

  it("UMIEM_GRADER_TIMEOUT_MS i MAX_CALLS_PER_SESSION nadpisują domyślne", () => {
    const grader = graderFromEnv({ ...base, UMIEM_GRADER_TIMEOUT_MS: "3000", UMIEM_GRADER_MAX_CALLS_PER_SESSION: "5" });
    expect(grader!.timeoutMs).toBe(3000);
    expect(grader!.maxCallsPerSession).toBe(5);
  });

  it("częściowa konfiguracja (brak klucza) → błąd", () => {
    expect(() => graderFromEnv({ UMIEM_GRADER_BASE_URL: base.UMIEM_GRADER_BASE_URL, UMIEM_GRADER_MODEL: base.UMIEM_GRADER_MODEL })).toThrow();
  });

  it("http:// odrzucone w produkcji", () => {
    expect(() => graderFromEnv({ ...base, UMIEM_GRADER_BASE_URL: "http://grader.example/v1", NODE_ENV: "production" })).toThrow();
  });

  it("http:// dozwolone poza produkcją (test/development)", () => {
    const grader = graderFromEnv({ ...base, UMIEM_GRADER_BASE_URL: "http://grader.example/v1", NODE_ENV: "development" });
    expect(grader).toBeDefined();
  });

  it("nieliczbowy albo niedodatni limit/timeout → błąd", () => {
    expect(() => graderFromEnv({ ...base, UMIEM_GRADER_TIMEOUT_MS: "nope" })).toThrow();
    expect(() => graderFromEnv({ ...base, UMIEM_GRADER_MAX_CALLS_PER_SESSION: "0" })).toThrow();
  });
});

describe("sessionActivityFromEnv", () => {
  const base = {
    UMIEM_GRADER_BASE_URL: "https://grader.example/v1",
    UMIEM_GRADER_API_KEY: "secret",
    UMIEM_GRADER_MODEL: "cheap-1",
  };

  it("bez konfiguracji gradera → undefined (ocena aktywności wyłączona)", () => {
    expect(sessionActivityFromEnv({})).toBeUndefined();
  });

  it("komplet UMIEM_GRADER_* → provider z domyślnym terminem 60 s", () => {
    const deps = sessionActivityFromEnv({ ...base });
    expect(deps).toBeDefined();
    expect(deps!.provider.model).toBe("cheap-1");
    expect(deps!.timeoutMs).toBe(60_000);
    expect(deps!.publicService).toBe("grader.example · cheap-1");
    expect(deps!.publicService).not.toContain("secret");
  });

  it("public service identity strips URL credentials, path and query", () => {
    const deps = sessionActivityFromEnv({
      ...base,
      UMIEM_GRADER_BASE_URL: "https://user:pass@grader.example:8443/v1?token=hidden",
    });
    expect(deps!.publicService).toBe("grader.example:8443 · cheap-1");
    expect(deps!.publicService).not.toContain("hidden");
    expect(deps!.publicService).not.toContain("pass");
  });

  it("częściowa konfiguracja → rzut (współdzielone zmienne gradera)", () => {
    expect(() => sessionActivityFromEnv({ UMIEM_GRADER_BASE_URL: base.UMIEM_GRADER_BASE_URL, UMIEM_GRADER_API_KEY: "k" })).toThrow();
  });

  it("pusty UMIEM_SESSION_ACTIVITY_TIMEOUT_MS → default 60000; własna wartość → użyta", () => {
    expect(sessionActivityFromEnv({ ...base, UMIEM_SESSION_ACTIVITY_TIMEOUT_MS: "" })!.timeoutMs).toBe(60_000);
    expect(sessionActivityFromEnv({ ...base, UMIEM_SESSION_ACTIVITY_TIMEOUT_MS: "45000" })!.timeoutMs).toBe(45_000);
    expect(() => sessionActivityFromEnv({ ...base, UMIEM_SESSION_ACTIVITY_TIMEOUT_MS: "-1" })).toThrow();
  });
});

describe("lessonSpeechFromEnv", () => {
  it("bez zmiennych lekcje nie mają dyktowania", () => {
    expect(lessonSpeechFromEnv({})).toBeUndefined();
  });

  it("adres i klucz dają STT z domyślnym modelem Scribe v2, nazwa publiczna bez sekretów", () => {
    const deps = lessonSpeechFromEnv({ UMIEM_LESSON_STT_BASE_URL: "https://openrouter.ai/api/v1", UMIEM_LESSON_STT_API_KEY: "sk-or-secret" });
    expect(deps?.stt.name).toBe(DEFAULT_LESSON_STT_MODEL);
    expect(deps?.publicService).toBe("elevenlabs/scribe-v2");
    expect(JSON.stringify(deps?.publicService)).not.toContain("sk-or");
  });

  it("model z env nadpisuje domyślny", () => {
    const deps = lessonSpeechFromEnv({
      UMIEM_LESSON_STT_BASE_URL: "https://openrouter.ai/api/v1", UMIEM_LESSON_STT_API_KEY: "k", UMIEM_LESSON_STT_MODEL: "mistralai/voxtral-small-transcribe-3-0",
    });
    expect(deps?.publicService).toBe("mistralai/voxtral-small-transcribe-3-0");
  });

  it("niepełna konfiguracja i http poza dev/test to błąd startu", () => {
    expect(() => lessonSpeechFromEnv({ UMIEM_LESSON_STT_API_KEY: "k" })).toThrow(/BASE_URL and API_KEY/);
    expect(() => lessonSpeechFromEnv({ UMIEM_LESSON_STT_BASE_URL: "http://stt.local/v1", UMIEM_LESSON_STT_API_KEY: "k" })).toThrow(/https/);
    expect(lessonSpeechFromEnv({ NODE_ENV: "test", UMIEM_LESSON_STT_BASE_URL: "http://stt.local/v1", UMIEM_LESSON_STT_API_KEY: "k" })).toBeDefined();
  });
});
