---
title: 'gh-384: klucz cache werdyktów lekcji zależy od modelu i treści promptu'
type: 'bugfix'
created: '2026-11-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Klucz `lesson_verdicts` to `(item_revision_id, normalized_answer, prompt_version)`, a `prompt_version` była ręczną stałą adaptera. Zmiana `UMIEM_GRADER_MODEL` albo profilu przedmiotu (`gradingRole`, `almostDefinition`) bez bumpa stałej serwowała stare werdykty bez końca.

**Approach:** Adapter liczy klucz `wersja:hash` (`providers/verdict-cache-key.ts`), gdzie hash obejmuje model, opcje pośrednika i wyrenderowany prompt systemowy (bez odpowiedzi dziecka). Bez zmiany schematu i migracji: kolumna `prompt_version` niesie nowy klucz, stare wiersze zostają historią, zakończone oceny bez zmian. Panel rodzica dopasowuje prefiks `wersja:` i bieżący `grader_model`.

</frozen-after-approval>

## Implementation Notes

- `AnswerGraderProvider.promptVersionForInput` jest teraz wymagane (port), moduł nie ma fallbacku na gołą wersję.
- `FakeAnswerGrader` przyjmuje `model` i liczy klucz tym samym helperem (model + profil przedmiotu).
- Testy: jednostkowy klucza w `grader.test.ts` (model, opcje, rola, definicja „almost”, rozsypanka zmieniają klucz; odpowiedź dziecka nie); integracyjny w `lesson-grader.test.ts` (zmiana modelu → nowe wywołanie i drugi wiersz; na starym kodzie pada: `expected 0 to be 1`); panel w `lesson-parent-supervision.test.ts` ukrywa werdykt innego modelu i klucz bez hasha.
- Znany limit (komentarz `shortcut:` w `lesson-supervision.ts`): do ponownej oceny odpowiedzi po zmianie promptu panel pokazuje wiersz starego hasha, którego decyzja nie działa.

## Review Triage Log

Niezależny recenzent (świeży kontekst, sam diff) + ponytail-review:
1. Panel pokazywał kilka hashy tej samej odpowiedzi — naprawione: najnowszy wiersz na (rewizja, odpowiedź, wersja), test w `lesson-parent-supervision`.
2. Wdrożenie wyłącza stare decyzje rodzica (klucze bez hasha) — udokumentowane w `docs/architecture.md`, `docs/provider-config.md` i PR; decyzja o przeniesieniu decyzji należy do właściciela.
3. Test `lesson-calculation` siał wiersz pod nieosiągalnym kluczem — naprawione (`calculation-test-v1:0`).
4. Hash bez `baseUrl` — naprawione, przypadek w `grader.test.ts`.
5. Brak testu integracyjnego zmiany profilu — pominięte: pokrywa test jednostkowy klucza, mechanizm ten sam co przy modelu.
6. LIKE bez escapowania — pominięte: wersje nie zawierają `_`/`%`.
7. `FakeSessionActivityReviewer.promptVersionForInput` — istniejące wcześniej, poza zakresem.

## Auto Run Result

Status: done
