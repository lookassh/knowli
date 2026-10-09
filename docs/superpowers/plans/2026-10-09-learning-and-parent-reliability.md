# Przygotowanie do sprawdzianu i niezawodność panelu — plan wykonania

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Delegacja wymaga wyraźnej zgody właściciela; nie została udzielona.

**Goal:** Wdrożyć zaakceptowane priorytety przed sprawdzianem, ochronę edycji i bezpieczne ponawianie generacji.

**Architecture:** Trzy niezależne plany korzystają z obecnego modularnego monolitu. Scheduler otrzymuje prywatny kontekst terminu, edytor zachowuje bazową wersję formularza, a klient generacji ponawia tę samą migawkę polecenia. Brak nowych endpointów, kolumn bazy oraz zależności.

**Tech Stack:** TypeScript strict, Next.js/React, Drizzle/PostgreSQL, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-09-learning-and-parent-reliability-design.md`, zaakceptowana 2026-10-09.

## Global Constraints

- Wyłącznie punkty 1–3 specyfikacji; wklejanie słówek, „Co dziś?” i zmiany raportu to kolejne projekty.
- UI i dokumentacja po polsku, marka `Umiem!`, komunikaty w `packages/contracts/src/messages.ts`.
- Reguły 300 sekund, potwierdzenia po przerwie, wariantów odpowiedzi, budżetu 12 zadań i obietnicy „Jeszcze 3” pozostają obowiązujące.
- Bez autosave, lokalnej kolejki i zapisu szkicu w localStorage.
- PostgreSQL i fake-providerzy; dane syntetyczne, bez przetwarzania nagrań dzieci.
- RED przed odpowiadającym mu kodem, potem GREEN. Dowody w checklistach.
- Selektywne commity; brak push, merge i deploy. Przy zleconej integracji finishing-a-development-branch.

## Review Focus

1. Polling podnosi editNumber, lokalny formularz pozostaje stary — PATCH nadal używa bazowego numeru (B1).
2. Zmiana czasu daje 49 lub 47 godzin między lokalnymi dniami — dokładnie 48 godzin do początku dnia sprawdzianu (A1).
3. Drugie okno publikuje szkic lub usuwa kartę — poprawki są zachowane bez automatycznego nadpisania (B3).
4. HTTP 202 ma nieczytelny JSON lub błędny UUID — retry zachowuje payload (C1).
5. Operacja zapisana, refresh zawodzi — nie ponawiamy tworzenia/zapisu (B1, C2).

## Kolejność i podział

Writing-plans zaleca osobne plany niezależnych podsystemów. Realizujemy kolejno:

- [x] A: `2026-10-09-test-preparation.md` — termin i scheduler.
- [x] B: `2026-10-09-parent-edit-protection.md` — wersja bazowa, wyjścia i konflikty.
- [x] C: `2026-10-09-generation-request-retry.md` — retry przyjęcia zlecenia.

Każdy plan kończy się niezależnie sprawdzalnym rezultatem. C korzysta z przekazania
obsługi wygasłej autoryzacji w ParentApp; nie dzieli stanu generacji z edytorem.

## Przygotowanie wykonania

- [x] Przeczytać executing-plans, using-git-worktrees i test-driven-development; sprawdzić status, git-dir, git-common-dir i aktualną gałąź.
- [x] Zweryfikować istniejący zarządzany worktree i detached HEAD. Użyć workflow using-git-worktrees dla istniejącego środowiska; nie tworzyć drugiego checkoutu bez potrzeby.
- [x] Uruchomić `pnpm test:unit`, potem `pnpm typecheck`. Przed przygotowaniem zależności nie uruchamiać dwóch pnpm równolegle — ten host automatycznie przygotowuje node_modules.
- [x] Wykonać A0: izolacja kontenera, portu i world file. Nie uruchamiać domyślnego runnera, który usuwa kontenery innych przebiegów.
- [x] Uzupełnić A0 o izolację portu health workera po wykryciu równoległego przebiegu w głównym checkoutcie; test konfiguracji RED/GREEN w `2026-10-09-test-preparation.md`.

## Odbiór pakietu

- [x] Własny test run ID `b2d0-reliability` i wolny port 24510; `pnpm test:unit` 288/288, `pnpm test:integration` 139/139, `pnpm test:e2e` 54/54, `pnpm typecheck`, `pnpm build`.
- [x] Obejrzeć konflikt, dialog wyjścia i uncertainty w 390×844, 768×1024, 1440×900; bez overflow, focus/klawiatura obsłużone przez testy dialogu.
- [x] Samodzielnie przejrzeć cały diff względem specyfikacji; brak niezależnego review.
- [x] verification-before-completion: świeże exit codes i liczby testów; checklisty oraz dokumentacja wykonania uzupełnione.
- [x] Raport ograniczeń: beforeunload zależy od przeglądarki, retry nie przetrwa reloadu, brak próby na prawdziwym tablecie i brak nowej walidacji live speech.

## Stan workflow

- [x] Spec zatwierdzona; trzy niezależne plany zapisane i samodzielnie przejrzane.
- [x] Właściciel zaakceptował bezpośrednie wykonanie w tej rozmowie, bez delegacji.
- [x] Implementacja B i C z TDD i małymi commitami.
- [x] Pełny odbiór, audyt checklisty i raport.
