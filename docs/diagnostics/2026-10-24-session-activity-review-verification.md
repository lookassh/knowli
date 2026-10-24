# Ocena aktywności sesji — potwierdzenie przyczyny i poprawka

## Dowody z produkcji

Odczyt autoryzowanego Parent API karty pracy z 2026-10-24 potwierdził
`model_timeout` dla wszystkich pięciu awarii opisanych w pierwotnym raporcie.
W chwili sprawdzania karta zawierała 21 sesji: 12 ocenionych, 6 timeoutów,
1 `invalid_verdict` i 2 sesje bez raportu; 1281 zatwierdzonych sekund i 21 punktów.
Nie było wśród tych awarii `model_failed` ani `review_interrupted`.
Nie ustalono jeszcze dokładnej przyczyny pojedynczego `invalid_verdict`.

Kody błędów są dostępne w `sessions[].activity.errorCode`; nie wymagają
dostępu do bazy. Poprawny JSON nie zapewnia zgodności ze schematem ani
poprawności numerów zadań. Pierwotne pięć awarii stanowiło 5/16 wszystkich
zakończonych sesji lub 5/14 sesji nauki, a nie jednoznaczne 42%.

## Zmiana

- Domyślny timeout oceny aktywności: 20 → 60 sekund. Deadline finalizacji
  pozostaje 120 sekund, podsumowanie nie czeka na ocenę.
- Bezpieczne logi rozróżniają timeout, HTTP ze statusem, format odpowiedzi,
  brak treści, JSON werdyktu, schemat oraz nieznany/powtórzony numer zadania.
  Zawierają czas wykonania, timeout, liczbę zadań i identyfikator sesji.
  Nie zawierają odpowiedzi, promptów, uzasadnień, body, komunikatów
  wyjątków providera ani odrzuconych kluczy Zod.
- Brak ponowień modelu, przeliczania historii i zmiany naliczania punktów.
- API → MCP → skill: bez zmian DTO, endpointów i kodów błędów;
  `learning-overview` oraz skill Hermesa nie wymagają aktualizacji.

## Weryfikacja lokalna

- TDD RED: 2 testy domyślnego timeoutu, 4 przypadki diagnostyki adaptera,
  test integracyjny braku logowania — zawiodły przed poprawką.
- GREEN: 1501 testów jednostkowych; 29 testów integracyjnych oceny
  aktywności na PostgreSQL w oddzielnym kontenerze `04fe-activity`.
- `pnpm typecheck`, `pnpm build`, `git diff --check`: poprawne.
- Prawdziwy OpenRouter / DeepSeek: jedna próba z 41 fikcyjnymi zadaniami,
  limit 60000 ms, odpowiedź po 4667 ms, poprawny schemat, zero wykluczeń.
  To próba połączenia i formatu, nie dowód odsetka awarii po zmianie.
- Niezależne review: PASS, bez istotnych usterek; reviewer dodatkowo
  uruchomił 25 testów konfiguracji i adaptera.

## Zastosowanie operacyjne

Zapisano w Coolify `UMIEM_SESSION_ACTIVITY_TIMEOUT_MS=60000` i zakończono
ponowne wdrożenie dotychczasowej wersji `c8758e8` (bez nowej diagnostyki).
Coolify potwierdził sukces 2026-10-24 o 11:41 czasu Europe/Warsaw,
deployment `n3ioqwr5mytircauzrhqruou`. W nowym kontenerze web odczytano
wyłącznie `process.env.UMIEM_SESSION_ACTIVITY_TIMEOUT_MS`; wynik `60000`
potwierdza przekazanie konfiguracji do środowiska kontenera.
Kod diagnostyki wymaga osobnego scalenia i wdrożenia. Stare oceny pozostają
niezmienione; skuteczność dłuższego limitu należy ocenić na nowych sesjach.
