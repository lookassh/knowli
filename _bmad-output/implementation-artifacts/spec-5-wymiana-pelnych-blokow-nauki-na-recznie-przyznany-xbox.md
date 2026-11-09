---
title: 'Zgłoszenie pakietu Xbox przez dziecko'
type: 'feature'
created: '2026-10-16'
status: 'done'
route: 'dispatch'
baseline_commit: 'b43c9ecf2e6c2d44221d0feaeab08f87804604a2'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/reward-rules.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/xbox-rewards.md'
---

<frozen-after-approval reason="approved scope — do not modify unless human renegotiates">

## Intent

**Problem:** Dziecko widzi dorobek i gotowe pakiety, ale nie może zgłosić wymiany ani zarezerwować konkretnego wypracowanego pakietu.

**Approach:** Pozwól dziecku zgłosić jeden pakiet Xbox, atomowo rezerwując 30 punktów i jeden pełny blok nauki. Zachowaj zgłoszenie jako oczekujące i pokaż dziecku jego stan; decyzja rodzica oraz ręczne dodanie czasu będą osobną, późniejszą story.

## Boundaries & Constraints

**Always:** Pakiet to 15 minut za 30 punktów i jeden blok 1800 rozliczonych sekund z jednego utrwalonego lokalnego dnia. Bloki nie wygasają, nie łączą dni ani nie są używane ponownie. Saldo odejmuje rezerwacje; dorobek pozostaje. Rezerwacja jest atomowa/idempotentna, dziecko ma najwyżej jedno otwarte zgłoszenie, a serwer sam wybiera blok i cenę. Zapisz migawkę bloku, daty i warunków.

**Never:** W tej story nie dodawaj decyzji rodzica, ręcznej realizacji minut, integracji Microsoft, sterowania Xbox/HA ani zmiany MCP `learning-overview`. Nie usuwaj ani nie zmniejszaj zdobytego dorobku.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zgłoszenie | Saldo ≥30 pkt i wolny blok | Rezerwuj blok i 30 pkt | Brak któregokolwiek: bez zmian |
| Retry/dwa klienty | To samo zgłoszenie lub blok | Jedna rezerwacja i oczekujące zgłoszenie | Nieaktualny stan: konflikt, bez ujemnego salda |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/reward-activity.ts` — źródło rozliczeń, punktów, salda i pakietów; użyj blokady per dziecko.
- `packages/server/src/db/schema.ts`, `packages/server/drizzle/0013_reward_points.sql` — źródło punktów/czasu/strefy; dodaj stabilne dzienne bloki i rezerwacje z unikalnością oraz kaskadą profilu.
- `packages/contracts/src/kid.ts`, `packages/server/src/modules/kid.ts`, `apps/web/src/kid/kid-router.ts` — ścisły kontrakt, saldo i Kid API.
- `packages/kid-ui/src/screens/ProfileScreen.tsx`, `packages/contracts/src/messages.ts` — saldo/pakiety; dodaj zgłoszenie i stan oczekujący.
- `tests/integration/reward-activity.test.ts` oraz testy UI/kontraktów — wzorce naliczeń; pokryj retry, współbieżność, saldo i izolację profili.

## Tasks & Acceptance

**Execution:**
- [x] Schemat/migracja — trwałe bloki dnia i rezerwacje, unikalność, kaskada profilu.
- [x] `packages/contracts/src/kid.ts`, moduł nagród i router Kid — ścisłe DTO, serwerowa kwalifikacja/cena, atomowy zapis idempotentny, saldo i stan.
- [x] `ProfileScreen.tsx`, `messages.ts` — zgłoszenie i oczekujący stan; blokada kolejnego zgłoszenia.
- [x] Testy jednostkowe/integracyjne — rzeczywiste RED/GREEN; próg, różne dni, retry, współbieżność, saldo, usunięcie profilu.

**Acceptance Criteria:**
- Given 30/60/90 min jednego dnia, when dziecko przegląda profil, then widzi 1/2/3 gotowe pakiety, ale zgłasza jeden naraz.
- Given niepełne bloki z różnych dni lub brak 30 pkt, when dziecko zgłasza pakiet, then saldo i uprawnienia nie zmieniają się.
- Given udana rezerwacja, when saldo się odświeża, then dorobek pozostaje, dostępne punkty maleją o 30, a blok nie wraca do puli.
- Given retry lub równoległe żądania, when dziecko zgłasza, then istnieje najwyżej jedno oczekujące zgłoszenie/rezerwacja.
- Given profil dziecka, when odczytuje status albo zostaje usunięty, then widać oczekiwanie lub kaskadowe usunięcie zgłoszenia.
- Given nowe Kid API, when testowany jest MCP, then `learning-overview` i skill zachowują semantykę; brak wpływu jest udokumentowany.

## Implementation Notes

Kontynuacja rodzica, ręczne dodanie czasu w Xbox Family oraz potwierdzenie/odrzucenie są odłożone do następnej story zapisanej w `deferred-work.md`. Używaj stabilnego identyfikatora pakietu (dziecko + lokalna data + numer bloku), nie pochodnej liczby `readyXboxPacks`, aby późniejsze zgłoszenie nie mogło wykorzystać tego samego czasu ponownie.

## Spec Change Log

- Implementacja: zgłoszenie Xbox rezerwuje trwale najstarszy wolny pełny blok lokalnego dnia i 30 punktów; dodano status w profilu dziecka. MCP bez zmian, ponieważ nowa ścieżka należy wyłącznie do Kid API i nie zmienia `learning-overview`.

## Review Triage Log

- **blind-hunter: ProfileScreen rodzeństwa — false.** Każda pozycja jest osobnym profilem w istniejącym selektorze dziecka; dziecko wskazuje profil działaniem przy tym profilu, zgodnie z obecnym modelem Kid API bez uwierzytelniania profilu.
- **blind-hunter: saldo punktów z niepełnych dni — false.** `reward-rules.md` rozdziela saldo punktów od pakietów Xbox; niepełne dni nadal dają punkty, a `readyXboxPacks` osobno komunikuje brak wymiany.
- **blind-hunter: retry po późniejszym potwierdzeniu — false.** Ta story nie dodaje ścieżki zmiany statusu; ponowne POST przy jedynym osiągalnym stanie `pending` zwraca tę samą rezerwację. Ponowienie po zamknięciu należy do późniejszego przepływu rodzica i jest nowym zgłoszeniem.
- **blind-hunter: komunikat błędu po sukcesie — false.** `KidApp.requestXboxPack` czyści błąd na początku każdego kolejnego zgłoszenia, także tego zakończonego sukcesem.
- **blind-hunter: podwójne odjęcie w fallbacku — false.** Fallback odejmuje punkty tylko, gdy migawka nie zawiera ID właśnie zwróconego zgłoszenia; dla retry tej samej rezerwacji ID się zgadza, a inne ID oznacza nową rezerwację.
- **blind-hunter: remis requestedAt — false.** W tej story jedyną operacją zapisującą zgłoszenie tworzy status `pending`, a unikalność ogranicza profil do jednego takiego wiersza; brak rodzicielskiej zmiany statusu oznacza, że równoczesny wybór starszego zamkniętego statusu jest nieosiągalny.
- **blind-hunter: brak testu pełnego cyklu po fulfillment — false.** Decyzja rodzica i zamknięcie zgłoszenia są jawnie odłożone do następnej story; ta zmiana testuje rezerwację, retry, saldo, migawkę i kaskadę profilu w swoim zakresie.
- **verification-gap: brak testu kontrolera po nieudanym odświeżeniu — patch.** Dodano test, w którym rezerwacja się udaje, odświeżenie profili zawodzi, a ekran nadal pokazuje oczekujące zgłoszenie i saldo po rezerwacji; test pliku przeszedł 68/68.
- **edge-case-hunter: remis requestedAt — false.** To ten sam scenariusz co finding blind-hunter; w aktualnym zakresie nie może powstać drugi ani zamknięty status, bo endpoint tworzy wyłącznie jeden aktywny wiersz `pending` na profil.

- Pełna integracja wykazała niepowiązane awarie środowiska PostgreSQL (`ECONNREFUSED 127.0.0.1:33177`) po uruchomieniu równoległych plików; target `auth-profiles` i nowy target `reward-activity` przechodzą osobno.

## Verification

**Commands:**
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/reward-activity.test.ts` — uprawnienia, naliczenia, rezerwacje i granice dni przechodzą na PostgreSQL.
- `corepack pnpm vitest run --config vitest.unit.config.ts` z testami kontraktu/UI — walidacja i stany zgłoszenia przechodzą.
- `corepack pnpm typecheck`, `git diff --check` — bez błędów.
- `corepack pnpm build` — przechodzi.
- `corepack pnpm test:integration` — nie przechodzi jako pełny zestaw: po 14 plikach zaliczonych środowiskowy PostgreSQL przestał odpowiadać (`ECONNREFUSED 127.0.0.1:33177`); odrębne testy `reward-activity` (4/4) oraz `auth-profiles` (16/16) przechodzą.
- `corepack pnpm vitest run --config vitest.unit.config.ts` — 132 pliki, 1241 testów przechodzi.
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/session/session-controller.test.ts` — 1 plik, 68 testów przechodzi; obejmuje fallback po nieudanym odświeżeniu profilu.
- Po poprawce review ponowiono `corepack pnpm vitest run --config vitest.unit.config.ts` — 132 pliki, 1242 testy przechodzą.
- Implementer potwierdził rzeczywisty RED dla nowej integracji: żądanie POST kończyło się 404 przed dodaniem route; surowy log pierwszego uruchomienia nie został zachowany. Targetowy GREEN `reward-activity` przeszedł 4/4.
- Ponowioną pełną integrację zatrzymano na polecenie rodzica po uruchomieniu; jej wyniku nie zaliczono.
