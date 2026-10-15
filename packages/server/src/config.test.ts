import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultMediaSettings, graderFromEnv, mediaSettingsFromEnv } from "./config";

describe("mediaSettingsFromEnv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bez env zwraca domyślne ustawienia (low + webp)", () => {
    expect(mediaSettingsFromEnv({})).toEqual(defaultMediaSettings);
    expect(defaultMediaSettings.image).toMatchObject({ quality: "low", format: "webp" });
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

  it("zastępuje nieobsługiwany rozmiar OpenAI domyślnym i ostrzega o konfiguracji", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const settings = mediaSettingsFromEnv({ UMIEM_IMAGE_SIZE: "512x512" });

    expect(settings.image.size).toBe("1024x1024");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("UMIEM_IMAGE_SIZE"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("512x512"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1024x1024"));
  });

  it("nie normalizuje rozmiaru dla innego providera obrazów", () => {
    const settings = mediaSettingsFromEnv({ UMIEM_IMAGE_PROVIDER: "custom", UMIEM_IMAGE_SIZE: "512x512" });

    expect(settings.image.size).toBe("512x512");
  });

  it("zachowuje niestandardową rozdzielczość dla modelu OpenAI obsługującego dowolne rozmiary", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const settings = mediaSettingsFromEnv({
      UMIEM_IMAGE_MODEL: "gpt-image-2",
      UMIEM_IMAGE_SIZE: "1536x864",
    });

    expect(settings.image.size).toBe("1536x864");
    expect(warn).not.toHaveBeenCalled();
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
