# Lekcja „to be” — niemożliwa publikacja po dogenerowaniu (2026-10-26)

## Objaw

Publikacja lekcji „Angielski — gramatyka: Czasownik «to be»” na produkcji
była zablokowana brakiem pokrycia: cel `english_grammar.to_be.negative_forms`
nie miał ani jednego ćwiczenia etapu samodzielnego (`lesson_open_answer`),
a polityka publikacji wymaga minimum 2 na każdym etapie ocenianym każdego
celu (`DEFAULT_LESSON_POLICY.poolMinimums`). Pozostałe 73 ćwiczenia szkicu
przechodziło walidację; 4 pozostałe cele miały wymagane ćwiczenia samodzielne.
Pięć kolejnych dogenerowań reguły przeczeń nie zmieniło stanu.

## Przyczyna

Model (deepseek/deepseek-v4.1-flash przez OpenRouter) regularnie — w 2 na 3
przebiegi odtworzone 1:1 z parametrami produkcji — zwracał dla przeczeń
poprawne ćwiczenie `lesson_open_answer`, ale w `acceptedAnswers` podawał
wariant skrótowy („They're not in my class.” przy odpowiedzi kanonicznej
„They aren't in my class.”). Normalizator english_grammar rozwija skróty,
więc po normalizacji wariant jest równoważny odpowiedzi kanonicznej i reguła
`validateAcceptedAnswers` (pool-validation.ts) odrzucała CAŁE ćwiczenie
z powodem „wariant duplikuje odpowiedź kanoniczną po normalizacji”.
Treść ćwiczenia była przy tym w pełni poprawna; redundantny wariant nie
wnosi informacji (odpowiedź kanoniczna jest akceptowana automatycznie,
a normalizator i tak zrównuje obie formy przy ocenie).

Inne cele trafnie warianty skrótowe omijały, dlatego tylko przeczenia
traciły ćwiczenia samodzielne — a pokrycie jest sprawdzane dopiero przy
publikacji, więc runy generowania kończyły się stanem `succeeded` z dziurą.

## Interwencja na produkcji (2026-10-26)

Ręcznie dodano 2 brakujące ćwiczenia samodzielne do wersji szkicu
`cc02737a-…` (deck `b7f2b942-…`), skryptem
wykonanym w kontenerze workera prawdziwym kodem aplikacji
(`applyLessonExercises` — cztery tabele: learning_items, skill_versions,
item_revisions, item_revision_skills) i podbiciem `edit_number` 9 → 10
(otwarty edytor dostaje konflikt zamiast nadpisać wstawki pełną listą):

- „Oni nie są w mojej klasie.” → „They aren't in my class.” (focus: aren't)
- „Nie jestem spóźniony.” → „I am not late.” (focus: am not; pełna forma)

Oba ćwiczenia zweryfikowano przed wstawieniem pełną walidacją publikacji
na danych z produkcji: `validatePool` 75/75 ważnych, `poolCoverage` bez
braków. Treść wygenerował ten sam model produkcyjny w przebiegu
diagnostycznym. Lekcja nie wymaga audio (english_grammar: `ttsForAnswers:
false`), wersja nie ma zasobów `revision_assets`.

## Poprawka (gałąź fix/lesson-redundant-accepted-variants)

- `withoutRedundantAcceptedVariants` (pool-validation.ts): czysta funkcja
  porzucająca warianty `acceptedAnswers` równoważne odpowiedzi kanonicznej
  po normalizatorze przedmiotu — dokładnie ta relacja, którą egzekwuje
  reguła walidacji. Generacja stosuje ją przy przyjęciu puli
  (lesson-drafts.ts), więc redundantny wariant przestaje zabijać całe
  ćwiczenie. Walidacja pozostaje egzekwatorem przy edycji i publikacji.
- Prompt adaptera LLM doprecyzowany ogólnie („a copy of the same words with
  expanded or contracted spellings, or different capitalization, is not
  [a different formulation]”), bez przykładów przedmiotowych — zgodnie z
  zasadą review C1.
- Fala poprawek po review (576814b): ta sama pełna relacja równoważności
  chroni `acceptVerdictAsVariant` (decyzja rodzica nad werdyktem) przed
  dopisaniem wariantu redundantnego; worker loguje licznik porzuconych
  wariantów linią `[lesson]`, gdy >0; zduplikowany lokalnie predykat
  równoważności scalony z eksportowanym `answersEquivalent`.

## Weryfikacja

- Testy jednostkowe: 5 nowych przypadków sanityzacji (pool-validation.test.ts),
  asercja promptu (llm.test.ts); pełny suit 2046/2046.
- Integracyjne (PostgreSQL): lesson-generation.test.ts — nowy test: model
  zwraca ćwiczenie z wariantem skrótowym, run kończy się `succeeded`,
  ćwiczenie zapisane bez wariantu, `rejectedCount` bez zmian, linia logu z
  licznikiem porzuconych; lesson-parent-supervision.test.ts — test
  `acceptVerdictAsVariant` (kontrola pozytywna + wariant redundantny przez
  drugą sekwencję skrótu dwuznacznego → `added=false`); 40/40 w obu plikach.
  Fixture testu logów przestawiony z duplikatu wariantu (znoszonego teraz
  sanityzacją) na pusty wariant.
- Typecheck czysty; testy granic modułów zielone; druga fala review (subagent)
  potwierdziła rozstrzygnięcie wszystkich znalezisk.

## Pozostaje

- Koniec generowania nadal nie sprawdza `poolCoverage` — run może skończyć
  się `succeeded` z dziurą pokrycia (obserwowalną dopiero w edytorze).
  Możliwy follow-up: dosuwanie partii brakujących etapów w budżecie prób.
- MCP/skill: bez zmian DTO, endpointów i autoryzacji — `learning-overview`
  i skill Hermesa nie wymagają aktualizacji.
