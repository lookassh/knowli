---
phase: 01-asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w
reviewed: 2026-10-21T19:41:03Z
depth: standard
commit: d65099c
diff_base: d65099c^
files_reviewed: 2
files_reviewed_list:
  - packages/kid-ui/src/session/session-controller.ts
  - packages/kid-ui/src/session/session-controller.test.ts
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Niezależny przegląd poprawki 01-05

## Narrative Findings (AI reviewer)

### WR-01 — WARNING: Pojedynczy błąd GET pozostawia trwale puste omówienie kartkówki

**File:** `C:/Users/looka/.codex/worktrees/async-session-completion/knowli/packages/kid-ui/src/session/session-controller.ts:792-797`, `:808-813`

**Issue:** Po zaakceptowanym zakończeniu sesji oba widoki otrzymują zastępcze `solutions: []`. Szczegóły są pobierane tylko raz, a odrzucenie żądania znika w `catch(() => undefined)`. Jeżeli pierwsze żądanie omówienia utraci sieć lub serwer zwróci przejściowy błąd, odzyskanie połączenia i terminalny wynik pollingu punktów nie podejmą kolejnego odczytu szczegółów. Dziecko pozostaje na ekranie „Omówienie” bez wyniku i odpowiedzi. Oba komponenty liczą wynik wyłącznie z `summary.solutions`, nie pokazują stanu ładowania/błędu i nie mają akcji ponowienia tego GET. Wcześniej błąd trafiał do mechanizmu błędu/retry ekranu nauki, więc istniała droga odzyskania omówienia. Nowy test błędu GET potwierdza wyłącznie zachowanie ekranu; nie sprawdza odzyskania szczegółów.

**Reproduction:** Zakończyć dowolną kartkówkę; dopuścić poprawną odpowiedź POST końca sesji; odrzucić pierwszy GET omówienia; przywrócić sieć. Pozostawić ten sam ekran: szczegóły nigdy nie zostaną ponownie pobrane.

**Fix:** Zachować natychmiastowe, interaktywne podsumowanie, ale modelować stan szczegółów (`loading` / `failed` / `loaded`) i udostępnić ponowienie wyłącznie GET omówienia lub ograniczone ponowienie w tle z istniejącą kontrolą `epoch`, `sessionId` i `childId`. Nie ponawiać POST raportu aktywności. Dodać regresję dla obu typów: pierwszy GET odrzucony, kolejny udany, po czym omówienie zawiera rozwiązania i zachowuje otrzymany wynik punktów.

## Zakres i ograniczenia

Przegląd statyczny diffu `d65099c^..d65099c` oraz wywoływanych przepływów kontrolera, komponentów podsumowań i serwerowych odczytów kartkówek. Bez zmian kodu źródłowego, uruchamiania testów ani commitów. Nie stwierdzono dodatkowego potwierdzonego błędu bezpieczeństwa w tym diffie. Przyjęty model zaufania/autoryzacji T-01-03 pozostaje poza oceną zgodnie z poleceniem.
