---
title: 'Profil → zestawy: B1–B4, polityki i wąski model odczytu'
type: 'refactor'
created: '2026-10-18'
status: 'ready-for-dev'
route: 'dispatch'
baseline_commit: '5356529150a92bd782c6118ab52b49e4fcd905ae'
review_loop_iteration: 0
context:
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/AGENTS.md'
  - 'C:/Users/looka/.codex/worktrees/b8a6/knowli/docs/diagnostics/2026-10-18-profile-navigation-repair-plan.md'
---

<frozen-after-approval reason="Właściciel zlecił pełną realizację planu; nadzorca ustala szczegóły wykonawcze">

## Intent

GPT Luna medium implementuje B1–B4 po zakończeniu A1. Lista zestawów ma czytać
wersjonowane projekcje, nie replay historii. Pozostałe aktywne przydziały
dotyczą tylko helperów lekcji i testowej infrastruktury benchmarku.
Zamierzone zmiany tych agentów nie wymagają ponownej zgody właściciela.

## Boundaries & Constraints

Historia pozostaje źródłem prawdy, a projektor domenowy jest jeden. Aktualizacje
faktów/postępu i źródła są atomowe. Retry i równoległe sesje nie gubią danych.
Brak danych nie oznacza braku nauki, gdy wymagany backfill nie jest gotowy.
Nie zmieniać reguł punktów, ocen, publicznych DTO. Nie przenosić historii do GET.
Bez zmian prod, push/commit/reset. Bez workerów utrzymujących asynchronicznie
projekcje, TTL cache i globalnych blokad. Nie edytować plików benchmarku/lekcji
innego agenta. Części lesson w kid.ts pozostawić do integracji nadzorcy.
RED → GREEN dla znaczących reguł, nie wymuszać nieistotnego shape implementacji.
Testy integracyjne izolować przez UMIEM_TEST_RUN_ID=nav-b.

## I/O & Edge-Case Matrix

| Stan | Operacja | Oczekiwany wynik |
| --- | --- | --- |
| Kilka polityk | stara sesja zapisuje ocenę | aktualizuje tylko własną politykę |
| Nowa polityka bez dowodu | lista/planer | stan początkowy, bez obcego statusu |
| Raport rodzica | różne polityki tej samej umiejętności | ostatnia wiarygodna ocena jawnie wybiera projekcję, bez zduplikowanych pozycji |
| Samo wydanie recall/speech/liter | brak oceny | fakt pierwszego wydania jest zachowany |
| Ujawnienie/feedback/cache/dystraktor | sealed event | atomowy MAX ekspozycji child/targetKey |
| Upływ czasu | bez nowego zapisu | rekomendacja i należność reagują na now |
| Błąd projektora | zapis źródłowy | rollback obu części |
| Powtórzenie operacji | retry | idempotencja |
| Brak projekcji historycznej | GET | wykryta niegotowość, nie fałszywe zero |

</frozen-after-approval>

## Code Map

- `db/schema.ts`: childSkillProgress, obecny PK child/skillVersion; dodać policyId do zakresu i niezależne fakty pracy/ekspozycji.
- `modules/skill-projections.ts`: jedyny wspólny writer postępu z projectProgress; użyć również w rebuild.
- `modules/attempts.ts`: persistSkillProjection po assessment, przed completed w tej samej transakcji.
- `modules/events.ts`: writeSealedEvent, wspólna pieczęć event+exposures; dobry punkt aktualizacji ekspozycji i faktów wydania z istniejącego taska.
- `modules/sessions.ts`: bezpośredni JOIN postępu oraz readLearningSnapshot; obie ścieżki muszą ograniczać policyId sesji.
- `modules/mock-tests.ts`: również surowe SQL child_skill_progress w buildMockTestContext i walidacji; sprawdzić policy scope i brak zduplikowanych joinów.
- `modules/learning-snapshot.ts`: usunąć fallback do innej polityki, pozostawić replay na potrzeby planera i audytu.
- `modules/published-progress.ts`: raport wybiera jawnie ostatnią wiarygodną politykę per skillVersion; uwzględnić remisy deterministycznie.
- `modules/progress-rebuild.ts`: dziś odtwarza wyłącznie ostatnią wiarygodną politykę; potrzebne wszystkie rzeczywiście istniejące zakresy i fakty bez oceny.
- `modules/kid.ts`: usunąć zbędny bezpośredni odczyt postępu i readLearningSnapshot; nowy readDeckLearningOverview do licznika/rekomendacji.
- `modules/reward-activity.ts`: czytniki nagród muszą móc użyć Executor tej samej migawki GET; bez zmiany zapisów nagród.
- `policies/registry.ts`, `deploy/migrate.ts`: ensureLearningPolicy przed gotowością instalacji zamiast INSERT w GET.
- `tests/integration/history.test.ts`, `progress-rebuild.test.ts`, `reporting.test.ts`, nowe `deck-learning-overview.test.ts`: macierz i zgodność.

## Design Notes

Ustalenie nadzorcy: dotychczasowy fallback z obcej polityki to potwierdzony błąd
izolacji. Lista i planer mają używać wyłącznie swojej polityki; to świadoma
poprawa, pokryta testem. Raport historycznego postępu zachowuje dotychczasowe
znaczenie ostatniej wiarygodnej oceny, teraz przez jawny wybór rekordu.

Stan docelowy:
- child_skill_progress PK (child, skillVersion, policy), projectionVersion osobno.
- firstIssuedAt i hasQualifyingAssessment dla właściwej umiejętności/polityki
  (w tej samej lub jednej pomocniczej tabeli faktów; uzasadnić podział).
- lastExposureAt PK (child,targetKey), globalny względem polityki/revision,
  obejmuje warianty i inne ujawnienia. MIN/MAX atomowe, bez lost update.
- ready/version marker pozwala wykryć nieukończony backfill; nowa pusta baza
  ma prawidłowy stan początkowy, historyczna baza wymaga rebuild przed GET.

Migracja nie może udawać, że historyczne statusy należą do CURRENT_POLICY_ID.
W fazie rozszerzenia można przypisać stary wiersz do polityki ostatniej
wiarygodnej oceny, ale trzeba odtworzyć wszystkie pozostałe zakresy z historii.
Istniejące testy ręcznie seedujące progress wymagają jawnego policyId i gotowych
faktów, gdy testują odczyt projekcji; nie dodawać produkcyjnego fallbacku dla fixture.

## Tasks & Acceptance

- [ ] B1: mapa konsumentów, RED izolacji polityki, schema i addytywna migracja wraz z journal/snapshot, projekt przełączenia.
- [ ] B2: wspólny writer postępu policy scoped; atomowe fakty wydania i ekspozycji; RED retry/rollback i testy.
- [ ] B3: idempotentny rebuild wszystkich zakresów i faktów, dry-run, backfill/readiness, zachowanie zakazu rebuild przy aktywnych/processing.
- [ ] B4: nowy wąski reader listy, bez historycznych promptów/assessment/exposure scans; jedna migawka RR/READ ONLY, jeden now.
- [ ] Dostosować wszystkie odczyty/writery/upsert/delete/reporty do policy scope, bez nowych niejawnych fallbacków.
- [ ] Usunąć ensureLearningPolicy z GET, zapewnić bootstrap/migrację/testy pustej instalacji.
- [ ] Nowe testy macierzy, istniejące history/rebuild/reporting/session; odpowiednie dokumenty i raport w osobnym profile-navigation-B-progress.md.

Given aktualizacja źródła, when commit/rollback, then źródło i projekcja są atomowe.
Given historia i fakty, when rebuild wykonany dwukrotnie, then stan identyczny z online i drugie apply bez zmian.
Given po backfillu wiele historii, when GET listy, then nie czyta assessments/attempts/event_exposures/learning_events ani public_prompt historii i niczego nie zapisuje.
Given jedna odpowiedź listy przy równoległym zapisie, when czyta kilka tabel, then widzi jedną spójną migawkę.
Given wersje polityk i kryteriów, when sesja kończy próbę, then nie awansuje innych zakresów.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

Na początku B1 wyślij nadzorcy krótki opis wybranego DDL i zakresu testów RED.
Po B1/B2 raportuj postęp przed B3/B4. Nie czekaj z informacją do końca całego B.
Uruchamiaj celowane unit/integration i typecheck. Pełną suite uruchomi nadzorca.
Nie modyfikuj oczekiwań testów tylko po to, żeby pasowały do nowego kodu; zmiany
fixture i zamierzone usunięcie fallbacku opisz. Operacyjne planowanie wdrożenia
to zadanie nadzorcy; żaden kod nie wdraża się automatycznie w tej pracy.
