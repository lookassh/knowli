# Plan podglądu kart rodzica (P2-10)

> REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

Spec: `docs/superpowers/specs/2026-10-13-lesson-card-preview-review-fix.md`, zatwierdzona przez właściciela 2026-10-13.
Cel: rodzic widzi te same teksty katalogu co dziecko, z aktualnie edytowanymi przykładami. Wykonanie: bieżący agent inline, jako Task 4 planu napraw PR #51, wspólny końcowy review.

### Task 1: Kontrakt i bezpieczny katalog

- [x] RED w `tests/integration/lesson-parent-api.test.ts`: katalog zawiera cards title/body, bez descriptionEn/hints/errorCategories; schemat akceptuje wynik.
- [x] GREEN w `packages/contracts/src/lessons.ts` i `packages/server/src/modules/lessons/lesson-api.ts`: dodać cards do celu katalogu i jawnie mapować title/body.
- [x] Unit/kontrakty i integracyjne API; zachować autoryzację rodzica.

### Task 2: Podgląd rodzica i zapis

- [x] RED w `tests/e2e/lesson-parent.spec.ts`: treść rzeczywistej karty oraz przykład w podglądzie przed i po edycji, ponowne wejście zachowuje treść.
- [x] GREEN w `apps/web/src/parent/lessons/LessonEditor.tsx`: pobrać katalog, wybrać temat/wersję i cel, renderować title/body oraz podstawienie lokalnych examples. Edytor przykładów zostaje istniejący, bez edycji reguły katalogu.
- [x] Nie importować domeny serwera do klienta; proste podstawienie znacznika bez wiedzy o przedmiocie.

### Task 3: Dokumentacja i weryfikacja

- [x] Aktualizacja architecture/SPEC o bezpiecznym katalogu rodzica, testy DTO/API i E2E, typecheck/build.
- [x] API→MCP→skill: brak zmiany narzędzi MCP i learning-overview v1, ponieważ katalog jest dostępny wyłącznie w parent API. Lekcje nadal wyłączone; uruchomić adekwatne istniejące testy MCP w końcowej weryfikacji.
- [x] Commit i dowody w wspólnym dzienniku napraw; niezależny review całego feature'u przed aktualizacją PR.

Review Focus: brak danych modelowych w katalogu, błędy odczytu katalogu, opublikowana treść tylko do odczytu, odświeżenie podglądu z niezapisanymi przykładami, brak regresji formularza tworzenia lekcji.
