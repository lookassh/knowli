---
title: 'gh-403: generowanie zestawu słówek na ścisłym schemacie (postLessonJson)'
type: 'refactor'
created: '2026-11-26'
status: 'done'
baseline_revision: '9dc0d5b4376a66b776bf3b9e3da7f6b206a67833'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/agents/providers-privacy.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `generateDeck` w `providers/openai/llm.ts` wysyła `response_format: json_object`, robi `JSON.parse` bez klasyfikacji (surowy `SyntaxError`) i zwraca po cichu `items: []`, gdy kształt jest zły — w odróżnieniu od lekcji, które używają strict `json_schema` z klasyfikacją błędów (`GenerationProviderError`: output/refusal/incomplete/HTTP).

**Approach:** `generateDeck` woła wspólną kopertę `postLessonJson` ze ścisłym schematem `{ items: [...] }` i `accept` sprawdzającym tablicę `items`; pola opcjonalne elementu (`example`, `visualData`) są w strict `null`-owalne, a adapter zdejmuje `null`, żeby przypadek użycia dostawał ten sam kształt co dotąd.

## Boundaries & Constraints

**Always:** jeden zapis kosztu na żądanie HTTP przed walidacją wyniku (feature `deck_generation`, operation `deck`); te same `requestExtras`, model, baseUrl i wiadomości (prompt systemowy i `user` bez zmian); pusta lista `{"items": []}` nadal poprawna.

**Never:** nie dodawać timeoutu do żądania zestawu (#412 odłożone — `timeoutMs` w kopercie staje się opcjonalne, zestaw go nie podaje); nie zmieniać promptu; nie zmieniać walidacji domenowej (`GeneratedItemSchema`, `selectMaterialItems`); brak wpływu na API/MCP/skill.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Poprawny wynik | `{"items":[{..., "example": null, "visualData": null}]}` | `{ items: [{...}] }` bez kluczy `example`/`visualData` | brak |
| Pusta lista | `{"items":[]}` | `{ items: [] }` | brak |
| Nie-JSON | content `"not json"` | odrzucenie | `GenerationProviderError` `output`, koszt zapisany raz |
| Zły kształt | `{}` albo `{"items": "x"}` | odrzucenie (zamiast pustego `items`) | `GenerationProviderError` `output` |
| HTTP 500 / 429 | status | odrzucenie | `GenerationProviderError` `transient` / `rate_limit` |
| Odmowa / `length` | `refusal` / `finish_reason: length` | odrzucenie | `refusal` / `incomplete` |

</intent-contract>

## Code Map

- `packages/server/src/providers/openai/llm.ts:405-451` -- obecne `generateDeck` (json_object, ręczny fetch i zapis kosztów); `lessonJson` config :392-401 do sklonowania z `usageFeature: "deck_generation"` bez `timeoutMs`.
- `packages/server/src/providers/openai/lesson-json-request.ts:27-36,103-104` -- `LessonJsonRequestConfig.timeoutMs` wymagane; `AbortSignal.timeout` zawsze.
- `packages/server/src/providers/openai/lesson-pool-schema.ts:79` -- konwencja `nullableEnum` (`anyOf` z `null`) dla strict.
- `packages/contracts/src/decks.ts:91-101` -- kształty `visualData` (color/number/sequence), `.strict()`.
- `packages/server/src/modules/materials/generation.ts:48-58,521-540` -- konsument: `GeneratedItemSchema` (`example`/`visualData` optional, nie nullable); każdy błąd poza Zod/validation = `provider` → ponowienie.
- `packages/server/src/providers/openai/llm.test.ts:597-612,726-842` -- testy zestawu (`json_object` w `deckMessages`) i kosztów (oczekiwania `SyntaxError`, `provider_http_500`, surowy AbortError/TypeError dla zestawu).
- `packages/server/src/providers/usage-recording.architecture.test.ts:12,23-34` -- inwentarz `PAID_ADAPTERS`; `llm.ts` bez `fetch` wypada z listy.

## Tasks & Acceptance

**Execution:**
- `packages/server/src/providers/openai/llm.test.ts` -- najpierw (RED): testy strict `json_schema` `vocabulary_deck`, nie-JSON i zły kształt → `output`, zdjęcie `null`; zaktualizować oczekiwania zestawu w testach kosztów do `GenerationProviderError`.
- `packages/server/src/providers/openai/lesson-json-request.ts` -- `timeoutMs` opcjonalne; bez niego tylko sygnał wywołującego.
- `packages/server/src/providers/openai/llm.ts` -- schemat zestawu, `generateDeck` na `postLessonJson`, usunięcie nieużywanych importów, aktualizacja komentarza adaptera.
- `packages/server/src/providers/usage-recording.architecture.test.ts` -- usunąć `openai/llm.ts` z `PAID_ADAPTERS`, poprawić komentarz.

**Acceptance Criteria:**
- Given adapter zestawu, when generuje, then ciało ma `response_format.type === "json_schema"`, `strict: true`, schemat wymaga `items`, a wiadomości są identyczne jak dotąd.
- Given brak `lessonRequestTimeoutMs`/dowolna wartość, when generuje zestaw, then żądanie nie ma timeoutu adaptera (sygnał = sygnał wywołującego).

## Design Notes

Pola strict muszą być wymagane, więc opcjonalne stają się `null`-owalne; model dostaje to ze schematu, prompt („Omit visualData…”) zostaje bez zmian. `visualData` jako `anyOf` trzech kształtów kontraktu + `null` (bez ograniczeń długości — waliduje domena). `visualType` pełny enum także w trybie obrazkowym (zawęża prompt i domena).

## Verification

**Commands:**
- `corepack pnpm vitest run packages/server/src/providers/openai/llm.test.ts packages/server/src/providers/usage-recording.architecture.test.ts` -- expected: zielone
- `corepack pnpm check` -- expected: zielone

## Auto Run Result

Status: done
- RED: 17 testów `llm.test.ts` pada na kodzie bazowym; GREEN na zmianie.
- Review: niezależny subagent (bez istotnych uwag) + `/ponytail:ponytail-review` (zastosowane: reużycie `strictObject` z `lesson-pool-schema.ts`, aktualny opis koperty, prostsze składanie sygnału).
- Zmiana zachowania (świadoma, AC): odpowiedź bez tablicy `items` (np. `{}`) to błąd `output` ponawiany jak inne błędy providera, a nie pusta lista.
- Niezweryfikowane: przyjęcie schematu przez prawdziwych providerów (płatne przebiegi wstrzymane).
