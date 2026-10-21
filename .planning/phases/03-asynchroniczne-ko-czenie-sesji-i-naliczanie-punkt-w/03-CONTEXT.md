# Phase 3: Asynchroniczne kończenie sesji i naliczanie punktów - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Po zakończeniu ćwiczenia lub kartkówki dziecko szybko widzi zapisane podsumowanie. Ocena aktywności przez LLM i naliczenie punktów kończą się asynchronicznie, a interfejs aktualizuje wynik po jego otrzymaniu. Oczekiwanie na punkty nie blokuje podsumowania ani dalszego korzystania z aplikacji.

Faza dotyczy wyłącznie komunikacji i prezentacji stanu naliczania punktów. Nie zmienia reguł oceny wiedzy, algorytmu naliczania punktów, prywatności raportu ani kryteriów oceny aktywności.

</domain>

<decisions>
## Implementation Decisions

### Dostępność podsumowania i komunikat o punktach
- **D-01:** Po zakończeniu sesji ekran podsumowania pojawia się bez oczekiwania na werdykt LLM. Pozostałe treści i działania na ekranie są dostępne podczas oczekiwania.
- **D-02:** W miejscu wyniku punktowego dziecko widzi krótki, zrozumiały komunikat, że punkty są jeszcze liczone. Spinner nie jest wymagany; konkretny wizualny wskaźnik i tekst może dobrać projektant/implementujący zgodnie z istniejącym stylem Umiem!.
- **D-03:** Po wyniku pojawiają się naliczone punkty albo istniejący komunikat o błędzie naliczenia; awaria oceny nie przyznaje punktów.

### Asynchroniczny wynik
- **D-04:** Klient używa krótkiego odpytywania statusu (polling), aby wykryć zakończenie oceny.
- **D-05:** Sprawdzanie trwa również po opuszczeniu podsumowania lub zmianie profilu. Wynik aktualizuje licznik punktów profilu dziecka, którego sesja została oceniona.
- **D-06:** Wynik pozostaje możliwy do odczytania po odświeżeniu lub powrocie do aplikacji; klient nie może uzależniać jego dostępności wyłącznie od stanu komponentu podsumowania.
- **D-07:** Zachować istniejącą zasadę pojedynczej oceny na sesję, brak automatycznych ponowień i brak punktów przy błędzie technicznym. Stan asynchroniczny nie może ponownie naliczyć punktów przy powtórzonym żądaniu.

### the agent's Discretion
- Dobór krótkiego tekstu oczekiwania i nieblokującego wskaźnika wizualnego.
- Interwał i strategia backoff pollingu oraz jego obsługa przy chwilowej utracie sieci, o ile nie blokują ekranu i pozwalają odzyskać zapisany wynik.
- Kształt kontraktu statusu i endpointu po analizie istniejących kontraktów oraz bezpieczeństwa.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wymagania produktu i prywatność
- `docs/SPEC.md` §36 — zbieranie raportu aktywności, ocena, punkty, błędy i widoki dziecka/rodzica.
- `docs/architecture.md` §21 — przepływ oceny, jednorazowość, brak kolejki/automatycznych ponowień, retencja i granica MCP.
- `.planning/ROADMAP.md` — zakres i kolejność fazy 3.

### Istniejący przepływ kodu
- `packages/kid-ui/src/session/session-controller.ts` — klientowy koniec sesji i przejście do podsumowania.
- `packages/kid-ui/src/screens/SessionActivityResultView.tsx` — prezentacja wyniku lub oczekiwania na punkty.
- `packages/contracts/src/reward-activity.ts` — kontrakt statusu wyniku aktywności.
- `packages/server/src/modules/sessions.ts` i `packages/server/src/modules/session-activity.ts` — zamykanie sesji oraz ocena aktywności.
- `apps/web/src/kid/kid-router.ts` — publiczne operacje Kid API.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SessionActivityResultView` już renderuje wynik punktowy i tekst oczekiwania dla `already_started`; warto rozszerzyć ten element zamiast tworzyć drugi ekran.
- `SessionActivityReviewRecord` przechowuje trwały wynik oceny, a `readSessionActivityResult` potrafi go odczytać po stronie serwera.
- `SessionActivityDraftStore` i identyczne ponowienia końcowego raportu chronią przed utratą raportu przy błędzie transportu.

### Established Patterns
- `session-controller.ts` koordynuje wszystkie typy sesji dziecka, a API klienta jest wstrzyknięte przez `KidApi`.
- Kontrakty DTO i walidacje granic są współdzielone w `packages/contracts`.
- API jest jawnie routowane przez `apps/web/src/kid/kid-router.ts`; klient Kid UI nie importuje kodu serwera.
- Punkty naliczane są atomowo wraz z trwałym wynikiem sesji; odczyt statusu nie może uruchamiać drugiej oceny ani ponownego naliczenia.

### Integration Points
- `endSession()` w `packages/server/src/modules/sessions.ts` obecnie oczekuje na `reviewSessionActivity()` przed zwróceniem podsumowania.
- `#finishSession()` w `packages/kid-ui/src/session/session-controller.ts` czeka na `KidApi.endSession()` przed ustawieniem ekranu podsumowania.
- Kontrakt `SessionActivityResultDto` obecnie obejmuje `evaluated`, `error` i `already_started`; nie ma osobnej operacji klienta do odpytywania wyniku.
- Sprawdź wpływ każdej zmiany Kid API na MCP i skill Hermesa. Obecna architektura celowo nie udostępnia raportu punktów przez MCP/`learning-overview`.

</code_context>

<specifics>
## Specific Ideas

- Dziecko ma zobaczyć podsumowanie od razu; oczekiwanie dotyczy wyłącznie punktów.
- Preferowane jest „krótkie sprawdzanie statusu”.
- Sprawdzanie ma trwać w tle również po przejściu dalej lub zmianie profilu.
- Użytkownik nie wymaga spinnera; istotne jest nieblokowanie UI i asynchroniczna komunikacja.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 3-Asynchroniczne kończenie sesji i naliczanie punktów*
*Context gathered: 2026-10-21*
