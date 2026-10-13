import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerationDepsFromEnv } from "./generation-env";

/**
 * Kontrakt konfiguracji LLM generującego materiał (zestawy + pule lekcji):
 * `UMIEM_LLM_MODEL`/`UMIEM_LLM_BASE_URL`/`UMIEM_LLM_API_KEY` nadpisują model,
 * endpoint i klucz samego LLM, z fallbackami do wartości domyślnych
 * (`gpt-4o-mini`, `https://api.openai.com/v1`) i `OPENAI_API_KEY`. Wzorzec
 * niezależnych zmiennych jak przy `UMIEM_TTS_*`/`UMIEM_IMAGE_*` (LLM jest
 * obowiązkową zależnością workera, nie opcjonalnym feature'em jak grader).
 * `UMIEM_LLM_BASE_URL` dostaje klucz w nagłówku Authorization, więc poza
 * NODE_ENV test/development wymaga `https://` — jak `UMIEM_GRADER_BASE_URL`.
 */

function okDeckResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }),
    { status: 200 },
  );
}

const DECK_INPUT = { prompt: "kolory", sourceLocale: "pl-PL", targetLocale: "en-GB", maxItems: 5 };

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  expect(fetchMock).toHaveBeenCalledOnce();
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGenerationDepsFromEnv — konfiguracja LLM przez UMIEM_LLM_*", () => {
  it("bez UMIEM_LLM_* używa domyślnego modelu i api.openai.com z kluczem OPENAI_API_KEY", async () => {
    const fetchMock = vi.fn(async () => okDeckResponse());
    vi.stubGlobal("fetch", fetchMock);

    const deps = createGenerationDepsFromEnv({ OPENAI_API_KEY: "sk-main" });

    expect(deps).toBeDefined();
    expect(deps!.llm.model).toBe("gpt-4o-mini");
    await deps!.llm.generateDeck(DECK_INPUT);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-main");
    expect(JSON.parse(String(init.body)).model).toBe("gpt-4o-mini");
  });

  it("UMIEM_LLM_MODEL nadpisuje model w żądaniu", async () => {
    const fetchMock = vi.fn(async () => okDeckResponse());
    vi.stubGlobal("fetch", fetchMock);

    const deps = createGenerationDepsFromEnv({ OPENAI_API_KEY: "sk-main", UMIEM_LLM_MODEL: "gpt-5-mini" });

    expect(deps!.llm.model).toBe("gpt-5-mini");
    await deps!.llm.generateDeck(DECK_INPUT);
    const [, init] = lastCall(fetchMock);
    expect(JSON.parse(String(init.body)).model).toBe("gpt-5-mini");
  });

  it("UMIEM_LLM_BASE_URL i UMIEM_LLM_API_KEY nadpisują endpoint i klucz samego LLM", async () => {
    const fetchMock = vi.fn(async () => okDeckResponse());
    vi.stubGlobal("fetch", fetchMock);

    const deps = createGenerationDepsFromEnv({
      OPENAI_API_KEY: "sk-main",
      UMIEM_LLM_BASE_URL: "https://llm.example/v1",
      UMIEM_LLM_API_KEY: "sk-llm",
    });

    await deps!.llm.generateDeck(DECK_INPUT);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-llm");
  });

  it("puste wartości UMIEM_LLM_* traktowane jak nieustawione", async () => {
    const fetchMock = vi.fn(async () => okDeckResponse());
    vi.stubGlobal("fetch", fetchMock);

    const deps = createGenerationDepsFromEnv({
      OPENAI_API_KEY: "sk-main",
      UMIEM_LLM_MODEL: "",
      UMIEM_LLM_BASE_URL: "",
      UMIEM_LLM_API_KEY: "",
    });

    expect(deps!.llm.model).toBe("gpt-4o-mini");
    await deps!.llm.generateDeck(DECK_INPUT);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-main");
  });

  it("http:// UMIEM_LLM_BASE_URL odrzucone poza test/development", () => {
    expect(() =>
      createGenerationDepsFromEnv({
        OPENAI_API_KEY: "sk-main",
        UMIEM_LLM_BASE_URL: "http://llm.example/v1",
        NODE_ENV: "production",
      }),
    ).toThrow(/UMIEM_LLM_BASE_URL/);
  });

  it("http:// UMIEM_LLM_BASE_URL dozwolone w development", async () => {
    const fetchMock = vi.fn(async () => okDeckResponse());
    vi.stubGlobal("fetch", fetchMock);

    const deps = createGenerationDepsFromEnv({
      OPENAI_API_KEY: "sk-main",
      UMIEM_LLM_BASE_URL: "http://localhost:9999/v1",
      NODE_ENV: "development",
    });

    await deps!.llm.generateDeck(DECK_INPUT);
    const [url] = lastCall(fetchMock);
    expect(url).toBe("http://localhost:9999/v1/chat/completions");
  });

  it("http:// UMIEM_LLM_BASE_URL dozwolone też w NODE_ENV=test", () => {
    const deps = createGenerationDepsFromEnv({
      OPENAI_API_KEY: "sk-main",
      UMIEM_LLM_BASE_URL: "http://localhost:9999/v1",
      NODE_ENV: "test",
    });
    expect(deps).toBeDefined();
  });

  it("UMIEM_FAKE_PROVIDERS=1 ignoruje UMIEM_LLM_* (deterministyczny fake)", () => {
    const deps = createGenerationDepsFromEnv({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_LLM_MODEL: "gpt-5-mini" });
    expect(deps!.llm.name).toBe("fake-llm");
    expect(deps!.llm.model).toBe("fake-llm-1");
  });
});
