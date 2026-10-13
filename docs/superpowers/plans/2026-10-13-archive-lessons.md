# Usuwanie lekcji z listy — zaakceptowany plan

REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

Plan i wykonanie inline zatwierdzone w czacie 2026-10-13. Właściciel wymaga TDD RED→GREEN i końcowego niezależnego review. Zmiana bounded: istniejąca archiwizacja i kontrakty pozostają bez zmian. Specyfikacją jest zaakceptowany projekt w czacie, odtworzony poniżej.

## Projekt

Rodzic usuwa konkretną utworzoną lekcję (np. Present Simple) przyciskiem „Usuń z listy” obok jej otwierania. Potwierdzenie podaje tytuł i informuje, że historia zostaje, a nowe sesje nie mogą być rozpoczynane. Używamy POST /api/v1/parent/decks/:deckId/archive (204). Archiwalne lekcje są domyślnie ukryte; checkbox „Pokaż archiwalne” umożliwia ich odnalezienie. Zachowanie listy słówek pozostaje zgodne z dotychczasowym.

Nie zmieniamy katalogu tematów, DTO, migracji, obsługi już trwających sesji ani nie dodajemy przywracania. Lekcje już są wykluczone z learning-overview, więc API → MCP → skill nie wymagają zmiany. Dodajemy polskie teksty do wspólnego katalogu komunikatów.

## Task 1: Testy i implementacja archiwizacji lekcji

- Dodać E2E z rzeczywistym API i fake providerami: potwierdzenie/anulowanie, usunięcie i trwałość po reload, pokazanie archiwum, brak przycisku usuwania przy archiwalnej lekcji, błąd żądania i ponowienie, blokada ponownego wysłania, wygaśnięcie sesji, brak regresji słówek. Potwierdzić RED przed kodem produktu.
- Dodać testy istniejącego endpointu na PostgreSQL: szkic i opublikowana lekcja, autoryzacja i Origin, idempotencja, zachowanie ćwiczeń i historii oraz odmowa startu nowej sesji. Te testy zabezpieczają istniejący kontrakt i mogą przejść od razu — nie stanowią dowodu RED nowego UI.
- Dodać kontrolkę w DecksPanel i dostępny dialog modalny (anulowanie domyślnym fokusem, Escape, powrót fokusu); blokować ponowne żądania, obsłużyć błędy oraz 401. Po potwierdzonym sukcesie nie przedstawiać błędu odświeżenia jako nieudanej archiwizacji.
- Uruchomić nowe E2E (Expected: wszystkie przechodzą), integrację lekcji (Expected: wszystkie przechodzą), unit, typecheck, build i adekwatne istniejące E2E rodzica (Expected: brak regresji).
- Zachować dziennik z RED, GREEN, decyzjami, wynikami i ograniczeniami. Commit dopiero po aktualnej weryfikacji.

## Task 2: Review i dostarczenie

- Przygotować review-package dla całego zakresu od aktualnego merge-base z origin/main wraz z niezacommitowanym diffem, wymaganiami i wynikami. Baza początkowa 9bde36e, po odświeżeniu main c77a04e.
- Niezależny recenzent gpt-6.1-sol, reasoning xhigh (najmocniejszy dostępny spoza GPT Astra), według requesting-code-review/code-reviewer.md. Implementacja pozostaje inline.
- Zweryfikować uwagi; blokujące poprawić z RED→GREEN i adekwatną regresją. Zapisać review i obsługę uwag.
- Końcowa weryfikacja, commit, workflow finishing-a-development-branch; push gałęzi i PR do main dopiero na końcu. Nie scalać PR.
