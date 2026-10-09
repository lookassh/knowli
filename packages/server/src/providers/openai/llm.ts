import type {
  LlmGenerateDeckInput,
  LlmGeneratedItem,
  LlmProvider,
} from "../../ports/ai";

export interface OpenAiLlmOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function systemPrompt(input: LlmGenerateDeckInput): string {
  return [
    "You create vocabulary learning sets for a young Polish child (about 8 years old).",
    `Source language: ${input.sourceLocale}. Target language: ${input.targetLocale}.`,
    "Return strict JSON: {\"items\": [{\"source\": string, \"target\": string,",
    "Each item may include visualData; it is required for color, number, and sequence and uses the matching shape described below.",
    "\"acceptedAnswers\": string[], \"example\": string, \"visualType\": \"image\"|\"color\"|\"number\"|\"sequence\"|\"none\"}]}.",
    "Use image only for concrete objects and actions. For colors use these exact canonical values in visualData: red #ff0000, blue #0000ff, green #008000, yellow #ffff00, orange #ffa500, purple #800080, pink #ffc0cb, black #000000, white #ffffff, brown #a52a2a, gray/grey #808080. For number use {count: integer 1-50}; for sequence use {position: integer, total: integer, position <= total, sequenceStart: string}.",
    "For English weekdays use position Monday=1 through Sunday=7 and total=7. Omit visualData when the word has no deterministic visual.",
    `At most ${input.maxItems} items. Keep target/source up to 120 characters and examples up to 300 characters.`,
    "One example sentence per item, in the target language. No extra commentary.",
  ].join(" ");
}

/**
 * Adapter LLM (structured output w trybie json_object; walidacja schematu
 * odbywa się w module generacji po stronie serwera). Wybór modelu czeka na
 * próbę techniczną z zadania 0 — bez kluczy adapter pozostaje niezweryfikowany.
 */
export function createOpenAiLlmProvider(options: OpenAiLlmOptions): LlmProvider {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  return {
    name: "openai",
    model,
    async generateDeck(input: LlmGenerateDeckInput, signal?: AbortSignal) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt(input) },
            { role: "user", content: input.prompt },
          ],
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`openai llm failed: ${response.status} ${await response.text()}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("openai llm returned no content");
      }
      const parsed = JSON.parse(content) as { items?: LlmGeneratedItem[] };
      return { items: parsed.items ?? [] };
    },
  };
}
