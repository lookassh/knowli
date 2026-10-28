/**
 * Opcjonalne pola zapytania chat completions dla pośrednika OpenRouter,
 * składane ze zmiennych środowiskowych z prefiksem `UMIEM_LLM` (generator)
 * albo `UMIEM_GRADER` (grader i ocena aktywności). Bez ustawionych zmiennych
 * wynik jest pusty i zapytanie pozostaje takie jak dotąd — zwykłe API
 * zgodne z OpenAI mogłoby odrzucić nieznane pola `reasoning` i `provider`.
 *
 * - `<P>_REASONING`: `off` (wyłączone rozumowanie) albo `minimal|low|medium|high`.
 * - `<P>_PROVIDER_ORDER`: lista dostawców po przecinku (kolejność preferencji).
 * - `<P>_PROVIDER_QUANTIZATIONS`: dozwolone kwantyzacje, np. `fp8,bf16`.
 * - `<P>_PROVIDER_ALLOW_FALLBACKS`: `true|false` — czy wolno wyjść poza listę.
 * - `<P>_PROVIDER_DATA_COLLECTION`: `deny` wyklucza dostawców zbierających
 *   dane z zapytań niezależnie od ustawień konta (odpowiedzi dzieci w graderze).
 *
 * Ustawienie dowolnej opcji dostawcy dokłada `require_parameters: true`, żeby
 * routing trafiał tylko do dostawców obsługujących wysyłane parametry
 * (np. ścisły `json_schema` puli lekcji).
 */
export type ChatRequestExtras = Readonly<Record<string, unknown>>;

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);
const SLUG = /^[a-z0-9][a-z0-9._ -]*$/i;

function list(name: string, value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const items = value.split(",").map((item) => item.trim()).filter((item) => item !== "");
  for (const item of items) {
    if (!SLUG.test(item)) throw new Error(`${name}: niedozwolona wartość „${item}”`);
  }
  return items.length > 0 ? items : undefined;
}

export function chatRequestExtrasFromEnv(
  env: Record<string, string | undefined>,
  prefix: "UMIEM_LLM" | "UMIEM_GRADER",
): ChatRequestExtras {
  const extras: Record<string, unknown> = {};

  const reasoning = env[`${prefix}_REASONING`]?.trim().toLowerCase();
  if (reasoning !== undefined && reasoning !== "" && reasoning !== "default") {
    if (reasoning === "off") extras.reasoning = { enabled: false };
    else if (REASONING_EFFORTS.has(reasoning)) extras.reasoning = { effort: reasoning };
    else throw new Error(`${prefix}_REASONING must be off, minimal, low, medium or high`);
  }

  const provider: Record<string, unknown> = {};
  const order = list(`${prefix}_PROVIDER_ORDER`, env[`${prefix}_PROVIDER_ORDER`]);
  if (order) provider.order = order;
  const quantizations = list(`${prefix}_PROVIDER_QUANTIZATIONS`, env[`${prefix}_PROVIDER_QUANTIZATIONS`]);
  if (quantizations) provider.quantizations = quantizations.map((q) => q.toLowerCase());
  const fallbacks = env[`${prefix}_PROVIDER_ALLOW_FALLBACKS`]?.trim().toLowerCase();
  if (fallbacks !== undefined && fallbacks !== "") {
    if (fallbacks !== "true" && fallbacks !== "false") throw new Error(`${prefix}_PROVIDER_ALLOW_FALLBACKS must be true or false`);
    provider.allow_fallbacks = fallbacks === "true";
  }
  const dataCollection = env[`${prefix}_PROVIDER_DATA_COLLECTION`]?.trim().toLowerCase();
  if (dataCollection !== undefined && dataCollection !== "") {
    if (dataCollection !== "deny" && dataCollection !== "allow") throw new Error(`${prefix}_PROVIDER_DATA_COLLECTION must be deny or allow`);
    provider.data_collection = dataCollection;
  }
  if (Object.keys(provider).length > 0) {
    provider.require_parameters = true;
    extras.provider = provider;
  }
  return extras;
}

/** Pola z env najpierw, pola adaptera (model, wiadomości, format) zawsze wygrywają. */
export function withChatRequestExtras<T extends Record<string, unknown>>(extras: ChatRequestExtras | undefined, body: T): T {
  return extras === undefined ? body : { ...extras, ...body };
}
