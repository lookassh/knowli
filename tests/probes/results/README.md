# Wyniki benchmarka modeli lekcji

> Generowane przez `pnpm bench table` z plików `*.json` w tym katalogu — nie edytuj ręcznie. Instrukcja: [`../README.md`](../README.md).

Komórka: publikowalne lekcje / przebiegi · odsetek wierszy z wadą (dowolna klasa W1–W9 rubryki) z przedziałem Wilsona 95% · koszt lekcji z rejestru.
Przy 60–150 wierszach na zadanie różnice kilku punktów procentowych mieszczą się w przedziałach — porównuj przedziały, nie same odsetki.
Koszt 0 przy dostawcy z kluczem właściciela (BYOK) nie oznacza darmowego biegu: tokeny są w rekordzie.

## Sędzia `muse:`

| zadanie | flash-stage5 | sonnet-stage5 |
|---|---|---|
| chapter-clothes-weather | pub 2/2 · wady 7,2% [4,1%–12,4%] n=153 · 0,32 USD | pub 2/2 · wady 14,6% [9,8%–21,1%] n=151 · 0,01 USD |
| chapter-food-likes | pub 1/2 · wady 8,2% [4,7%–14,1%] n=134 · 0,26–0,27 USD | pub 0/2 · wady 16,8% [11,6%–23,6%] n=149 · 0,01 USD |
| chapter-home-rooms | pub 2/2 · wady 6,6% [3,6%–11,8%] n=151 · 0,31 USD | pub 2/2 · wady 12,0% [7,7%–18,2%] n=150 · 0,01–0,02 USD |
| grammar-present-continuous | — | pub 1/1 · wady 16,9% [10,1%–26,8%] n=77 · 0,00 USD |
| grammar-present-simple | — | pub 1/1 · wady 26,5% [18,2%–36,9%] n=83 · 0,00 USD |
| grammar-to-be | — | pub 1/1 · wady 4,4% [1,5%–12,2%] n=68 · 0,00 USD |
| school-baptism-poland | pub 1/2 · wady 6,5% [3,3%–12,3%] n=123 · 0,37–0,43 USD | pub 0/2 · wady 13,6% [8,4%–21,3%] n=110 · 0,02 USD |
| school-plant-parts | pub 2/2 · wady 3,8% [1,6%–8,6%] n=131 · 0,36–0,43 USD | pub 0/2 · wady 13,3% [8,4%–20,6%] n=120 · 0,01–0,02 USD |

Rekordy:

- **flash-stage5** (2026-11-09) — commit `09e9835f`; generator `google/gemini-3.8-flash`, objectives `google/gemini-3.8-flash`, objectivesReasoning `low`, checker `deepseek/deepseek-v4.1-flash-1017`, grader `google/gemini-3.8-flash`, effort `low`; sędzia Muse Code 1.4.14 (model domyślny wg notatek biegów: muse-wonder-full-1.0). Z istniejących zrzutów etapu 5: rozdział — bieg potwierdzający 5a (commit 09e9835f, „+3”), szkoła — strojenie 2 etapu 5b (commit 0ca0e205), kontrola wzorcowa — 4f513128 (rozdział) i 414370e3 (szkoła). Gramatyka nie była oceniana tym sędzią.
- **sonnet-stage5** (2026-11-09) — commit `a78e981c`; generator `anthropic/claude-sonnet-5.5`, objectives `anthropic/claude-sonnet-5.5`, objectivesReasoning `low`, checker `deepseek/deepseek-v4.1-flash-1017`, grader `google/gemini-3.8-flash`, effort `low`; routing: UMIEM_LLM_PROVIDER_ORDER=anthropic, UMIEM_LLM_PROVIDER_ALLOW_FALLBACKS=false, UMIEM_LESSON_AGENT_CHECKER_PROVIDER_ALLOW_FALLBACKS=true; sędzia Muse Code 1.4.14 (model domyślny wg notatek biegów: muse-wonder-full-1.0). Bieg potwierdzający etapu 5 z kredytu Anthropic (BYOK): koszt w rejestrze ok. 0, z tokenów 1,15–1,30 USD (szkoła), 0,86–1,00 (rozdział), 0,53–0,80 (gramatyka) na lekcję. Gramatyka 1 powtórzenie.

## Kontrola zadań zamkniętych (ćwiczenia wzorcowe)

Suma po powtórzeniach. Cel z `closed-check-gold.probe.test.ts`: zły klucz zawsze wykryty, druga poprawna odpowiedź ≥ 80%, poprawne odrzucone ≤ 10%.

| zadanie | rekord | model kontroli | powtórzenia | poprawne odrzucone | zły klucz wykryty | druga poprawna wykryta (per powtórzenie) |
|---|---|---|---|---|---|---|
| gold-chapter | flash-stage5 | `deepseek/deepseek-v4.1-flash-1017` | 3 | 0/54 | 48/48 | 16/27 (4, 8, 4) |
| gold-school | flash-stage5 | `deepseek/deepseek-v4.1-flash-1017` | 3 | 0/54 | 54/54 | 42/42 (14, 14, 14) |
