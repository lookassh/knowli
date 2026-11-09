---
title: 'Rodzic rozpatruje zgłoszenie Xbox'
type: 'feature'
created: '2026-10-16'
status: 'done'
route: 'dispatch'
baseline_commit: 'bf9e3e76df1ba263643a85811215a43a1078a291'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/xbox-rewards.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-wymiana-pelnych-blokow-nauki-na-recznie-przyznany-xbox.md'
---

<frozen-after-approval reason="approved scope — do not modify unless human renegotiates">

## Intent

**Problem:** Dziecko może zgłosić pakiet Xbox, ale rodzic nie widzi go w karcie pracy ani nie może rozliczyć ręcznej decyzji.

**Approach:** Pokaż zgłoszenie z jego źródłowym dniem przy karcie pracy dziecka. Rodzic przegląda dane i rundę tego dnia, sam dodaje czas w Xbox Family, a potem potwierdza w Umiem! albo odrzuca zgłoszenie przed dodaniem czasu.

## Boundaries & Constraints

**Always:** Parent Mode chroni odczyt, same-origin zapis. `pending → fulfilled` deklaruje ręczne dodanie 15 min; `pending → rejected` zwalnia blok i 30 pkt. Dorobek nie maleje. Ta sama decyzja jest idempotentna; przeciwna po zamknięciu odrzucona. Niepewność zostawia `pending`, aż rodzic sprawdzi Xbox Family. Potwierdzenie nie oznacza, że konsola jest odblokowana. Kilka pakietów tego dnia korzysta z tej samej rundy. Wszystkie oczekujące prośby wybranego dziecka są widoczne niezależnie od filtra daty, ze źródłową datą i przejściem do karty tego dnia.

**Never:** Bez API, logowania ani tokenów Microsoft, automatycznego dodawania minut, sterowania Xbox/HA, cofania dorobku ani oceny uczciwości. Nie potwierdzaj czasu, którego rodzic nie dodał ręcznie.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Przegląd | Profil i źródłowy dzień | Pakiet + karta pracy | Brak auth/ID: `401`/`404` |
| Decyzja | `pending`; dodano lub nie dodano czasu | `fulfilled` zużywa; `rejected` zwalnia rezerwację | Ta sama decyzja idempotentna; inna: konflikt |
| Niepewność | Wynik Microsoft nieznany | Zostaw `pending` do sprawdzenia konta | Bez zmiany |

</frozen-after-approval>

## Code Map

- `packages/server/src/db/schema.ts`, `packages/server/drizzle/0015_reward_activity_xbox.sql` — statusy/snapshot; bez integracji Microsoft.
- `packages/server/src/modules/reward-activity.ts` — saldo/rezerwacja per dziecko; dodaj serializowane przejścia statusu.
- `packages/contracts/src/parent-work-card.ts`, `packages/server/src/modules/parent-work-card.ts` — strict DTO/dane dnia; rozszerz o zgłoszenie.
- `apps/web/src/parent/parent-router.ts` — chroniony router; dodaj decyzję.
- `apps/web/src/parent/WorkCardPanel.tsx`, `packages/contracts/src/messages.ts` — UI karty; dodaj status i akcje.
- `tests/integration/reward-activity.test.ts`, `tests/integration/parent-work-card.test.ts`, `tests/e2e/parent-work-card.spec.ts` — integracja/auth/E2E.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/parent-work-card.ts`, `packages/server/src/modules/parent-work-card.ts` — zgłoszenie i snapshot dnia.
- [x] `packages/server/src/modules/reward-activity.ts`, `apps/web/src/parent/parent-router.ts` — atomowe/idempotentne decyzje; Parent Mode + CSRF.
- [x] `apps/web/src/parent/WorkCardPanel.tsx`, `packages/contracts/src/messages.ts` — status, ręczne kroki Xbox Family i decyzje.
- [x] `tests/integration/reward-activity.test.ts`, `tests/integration/parent-work-card.test.ts`, `tests/e2e/parent-work-card.spec.ts` — RED–GREEN, auth, stany, retry, współbieżność; niezależne review.

**Acceptance Criteria:**
- Given rodzic wybiera zgłoszenie, when przegląda źródłowy dzień, then widzi pakiet i kartę pracy/rundę.
- Given dodano czas, when rodzic potwierdza, then `fulfilled` zużywa blok/punkty raz bez obietnicy odblokowania.
- Given czasu nie dodano, when rodzic odrzuca, then `rejected` zwalnia saldo/blok, nie dorobek.
- Given wynik zewnętrzny niepewny, when rodzic wraca, then status pozostaje `pending` do weryfikacji.
- Given retry/dwie karty/terminalny stan, when zapisują decyzję, then brak podwójnej zmiany; auth odrzuca żądania obce.

## Implementation Notes

Wykorzystaj istniejące statusy/snapshoty. Potwierdzaj dopiero po ręcznym dodaniu; niepewny wynik zostaje otwarty do sprawdzenia. Rodzic wybiera konto dziecka poza Umiem!; aplikacja nie zapisuje danych Microsoft. Nowy Parent API nie rozszerza MCP `learning-overview`; potwierdź i opisz brak zmian jego kontraktu/skilla.

## Spec Change Log

- Rozszerzono chronioną kartę pracy o migawki zgłoszeń, kolejkę wszystkich oczekujących zgłoszeń wybranego dziecka oraz decyzje rodzica serializowane blokadą dziecka. Potwierdzenie/odrzucenie aktualizuje wyłącznie status istniejącego zgłoszenia; Parent API pozostaje poza `learning-overview`, więc schemat MCP i `SKILL.md` nie wymagają zmian.

## Review Triage Log

- **blind-hunter — false.** Raport nie jest renderowany podczas odświeżania (`report && !loading`), więc stara lista nie pokazuje chwilowo fałszywego pustego stanu.
- **blind-hunter — low / patch.** Po zmianie dziecka lub dnia błąd poprzedniej decyzji był nadal widoczny; reset komunikatu dodano przy zmianie wyboru.
- **blind-hunter — low / patch.** Obie akcje pokazywały tę samą etykietę zapisu; etykieta wskazuje teraz potwierdzenie albo odrzucenie.
- **blind-hunter — false.** Przycisk potwierdzenia jawnie mówi „Potwierdzam ręczne dodanie 15 minut”, zgodnie z deklaracją rodzica wymaganą przed statusem `fulfilled`.
- **blind-hunter — medium / patch.** Karta pobierała całą historię zgłoszeń; zapytanie zwraca teraz wszystkie `pending` oraz zamknięte zgłoszenia tylko dla wybranego źródłowego dnia.
- **blind-hunter — low / patch.** Test kontraktu sprawdzał wyłącznie `pending`; dodano przypadki statusów `fulfilled` i `rejected`.
- **edge-case-hunter — medium / patch.** Opóźniona decyzja mogła po zmianie filtra uruchomić pobranie starego dziecka/dnia; odświeżenie jest warunkowane aktualnym wyborem i numerem żądania.
- **verification-gap — medium / patch.** Brakowało testu równoległych, przeciwnych decyzji dla jednego zgłoszenia; dodano wyścig `fulfilled`/`rejected`, w którym jedna decyzja wygrywa, a druga otrzymuje konflikt.
- **blind-hunter — false.** Odświeżenie po decyzji przechodzi przez `load()`, które przechwytuje błąd odczytu i pokazuje go jako błąd raportu; nie zgłasza go jako niepowodzenia zapisu decyzji.
- **blind-hunter + edge-case-hunter — low / patch.** Błąd spóźnionej decyzji mógł pojawić się po zmianie dziecka lub daty. Aktualizacja komunikatu jest teraz ograniczona do aktualnego wyboru i numeru żądania, z testem regresji.
- **blind-hunter — false.** Lista zgłoszeń służy do nawigacji do dnia źródłowego, a szczegóły i akcje znajdują się w osobnej karcie dla tego dnia; są to celowo dwa kroki przeglądu.
- **blind-hunter — false.** Lista nawigacyjna pokazuje wymagane źródłową datę i numer bloku. Czas i runda są widoczne po przejściu do źródłowego dnia, zgodnie z zakresem.
- **blind-hunter — false.** W `Implementation Notes` i dzienniku specyfikacji zapisano, że nowy Parent API nie rozszerza `learning-overview`, więc kontrakt MCP i skill pozostają bez zmian.
- **blind-hunter + verification-gap — low / patch.** Brakowało przeglądarkowego sprawdzenia odmowy; dodano test payloadu `rejected` i statusu odrzuconego. Test przeszedł.

## Verification

**Commands:**
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/reward-activity.test.ts tests/integration/parent-work-card.test.ts` — 2 pliki, 8 testów; transakcje/auth.
- `corepack pnpm vitest run --config vitest.unit.config.ts` — kontrakt/UI; `corepack pnpm exec playwright test tests/e2e/parent-work-card.spec.ts` — karta.
- `corepack pnpm typecheck`, `git diff --check` — bez błędów.
- RED: implementer zgłosił, że test integracyjny nowego endpointu początkowo otrzymał 404 przed dodaniem trasy; surowy log tego uruchomienia nie został zachowany.
- GREEN: integracja — 2 pliki, 8 testów (po korekcie testu rywalizacji ponowiony target nagród: 5/5); jednostki — 132 pliki, 1243 testy; Playwright — 5 testów po review; `typecheck` i `git diff --check` bez błędów.
- Niezależne review: blind hunter, edge case hunter i verification-gap; zweryfikowane uwagi zapisano powyżej, poprawki przechodzą testy. Brak odroczonych uwag. Nowy Parent API nie zmienia MCP `learning-overview` ani skilla.
