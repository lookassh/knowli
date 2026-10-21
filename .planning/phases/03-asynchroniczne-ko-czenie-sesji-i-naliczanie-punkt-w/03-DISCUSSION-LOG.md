# Phase 3: Asynchroniczne kończenie sesji i naliczanie punktów - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-21
**Phase:** 3-Asynchroniczne kończenie sesji i naliczanie punktów
**Areas discussed:** Asynchroniczne kończenie sesji i punkty

---

## Asynchroniczne kończenie sesji i punkty

| Option | Description | Selected |
|--------|-------------|----------|
| Czekać z całym ekranem | Podsumowanie pojawia się dopiero po odpowiedzi serwera i LLM. | |
| Podsumowanie od razu | Pokazać treść podsumowania, a wynik punktów uzupełnić po zakończeniu oceny. | ✓ |
| Długi kanał serwer-push | Utrzymywać połączenie i przesłać wynik z serwera natychmiast po ocenie. | |
| Krótkie odpytywanie statusu | Klient cyklicznie sprawdza zapisany stan oceny. | ✓ |
| Zatrzymać sprawdzanie po opuszczeniu podsumowania | Polling trwa wyłącznie, gdy ekran podsumowania jest otwarty. | |
| Kontynuować w tle | Po wyniku zaktualizować licznik punktów właściwego profilu. | ✓ |

**User's choice:** Podsumowanie od razu, krótkie sprawdzanie statusu i kontynuowanie sprawdzania w tle po opuszczeniu podsumowania.
**Notes:** Spinner nie jest wymagany. Priorytetem jest nieblokujące UI i komunikacja asynchroniczna.

---

## the agent's Discretion

- Krótki tekst i wizualny wskaźnik oczekiwania na punkty.
- Konkretna częstotliwość pollingu, backoff i odzyskiwanie statusu przy chwilowej utracie sieci.
- Szczegóły kontraktu/endpointu po analizie istniejących granic i zabezpieczeń.

## Deferred Ideas

Brak.
