---
title: 'Krótka zapowiedziana runda dnia'
type: 'feature'
created: '2026-10-16'
status: 'withdrawn'
route: 'dispatch'
baseline_commit: 'e5a1508dc152f3e6c6833debf768fa1c5c947f41'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/daily-round.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/acceptance-scenarios.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-zaliczanie-aktywnego-czasu-nauki.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-punkty-dorobek-zestawow-cel-dnia.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dziecko nie ma krótkiej, zapowiedzianej porcji powtórki opartej na tym, czego uczyło się danego dnia. Zwykła sesja treningowa może wydawać dalsze zadania, a kartkówka jest osobnym, zamrożonym trybem.

**Approach:** Przed rozpoczęciem zwykłej nauki dziecko może uruchomić jedną rundę dnia dla wybranego dziś ćwiczonego zestawu. Serwer dobiera bezpieczne zadania z dzisiejszych kontaktów i prowadzi je przez istniejący silnik jako oddzielną, ograniczoną sesję.

## Boundaries & Constraints

**Always:** Runda jest dobrowolna, jawnie nazwana i dostępna przed startem zwykłej sesji; nie jest dokładana po komunikacie o końcu ani do kartkówki. Jedno dziecko może rozpocząć najwyżej jedną rundę na lokalny dzień rodziny; aktywną rundę można wznowić tą samą sesją, ale zakończonej lub porzuconej nie uruchamia się drugi raz. Używaj najwyżej trzech wydanych zadań łącznie, wliczając prezentacje i karty lekcji; mniejsza bezpieczna pula skraca rundę, a zero nie tworzy fikcyjnego zadania. Wybór pytań pozostaje po stronie serwera; korzystaj z istniejących rezerwacji, zasad samodzielności, ochrony ujawnień, adapterów i SubjectModule. W miarę dostępności wybieraj różne kontakty z dzisiejszej pracy. Wersja materiału i lokalny dzień są ustalane po stronie serwera. Czas zaakceptowany według story 1 normalnie nalicza punkty według story 2, bez progu poprawności i premii. Zapisuj stan oraz wykonane kroki tak, aby kolejna story mogła pokazać je rodzicowi.

**Never:** Nie używaj trybu kartkówki ani nie zmieniaj jego planu, ocen, gwiazdek lub historii opanowania. Nie wydawaj więcej niż trzech kroków przez retry, wznowienie, zadania bez oceny lub karty lekcji. Nie losuj sztucznego materiału i nie ujawniaj odpowiedzi przed trwałym zapisem ekspozycji. Nie implementuj karty rodzica, oceny uczciwości, automatycznego odebrania nagrody ani integracji Xbox/Microsoft.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full round | Dziś ćwiczony zestaw ma co najmniej 3 bezpieczne kontakty | Serwer wydaje do 3 kroków, bez czwartego po ponowieniu żądania | Retry zwraca to samo wydane zadanie |
| Small pool | Zestaw ma 1–2 bezpieczne kontakty | Runda kończy się po dostępnej liczbie kroków | Bez sztucznych zadań |
| Empty pool | Brak bezpiecznych kontaktów z dziś | Brak startu rundy; status dostępności jest czytelny dla dalszego podglądu rodzica | Zwykła nauka nadal dostępna |
| Daily replay | Runda już rozpoczęta lub zakończona dla dziecka i lokalnej daty | Aktywna sesja może być wznowiona; nie powstaje druga runda | Konflikt nie tworzy nowej sesji |
| Lesson flow | Plan lekcji proponuje kartę i ćwiczenia | Każdy pokazany krok zużywa limit 3 | Żadna ścieżka nie wydaje czwartego kroku |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/sessions.ts` — `startSession`, `nextTask`, `planNextTask`; blokady, przypięcie wersji, zwykłe planowanie i limit czasu do wykorzystania. Obecny `taskBudget` liczy zadania oceniane, więc limit rundy musi osobno uwzględnić wszystkie wydane kroki.
- `packages/server/src/modules/reward-activity.ts`, `packages/server/src/domain/reward-activity.ts` — `validRewardTimezone`, `localDateAt` i czas sesji zapewniają wspólną rodzinną datę lokalną; historię kontaktów ogranicz do dziecka, zestawu, przypiętej wersji i tej daty.
- `packages/server/src/db/schema.ts` — `learningSessions`, `sessionTasks`, `learningEvents` i `eventExposures` opisują sesje oraz utrwalone kontakty/ujawnienia; użyj danych serwera, nie listy klienta.
- `packages/server/src/modules/lessons/lesson-sessions.ts` — `planLessonTask`, `issueNextLessonTask`; zachować harmonogram lekcji i transakcyjny zapis ekspozycji, ale wspólny limit rundy obejmuje też `lesson_card`.
- `packages/server/src/domain/scheduler.ts`, `packages/server/src/domain/lessons/scheduler.ts` — istniejące selektory chronią sprawdziany, rezerwacje, postęp i wsparcie; zawężenie do dzisiejszych kontaktów nie może omijać tych reguł.
- `packages/server/src/db/schema.ts`, migracje Drizzle oraz `packages/contracts/src/kid.ts` — sesje dopuszczają dziś tylko `training` i `mock_test`; odróżnij rundę, zapisz jej lokalny dzień i wymuś unikalność dziecko/dzień atomowo.
- `packages/server/src/modules/kid.ts`, `apps/web/src/kid/kid-router.ts`, `packages/kid-ui/src/api/KidApi.ts` i `client.ts` — istniejące listowanie zestawów, endpoint sesji i klient; dodaj odczyt dostępności/start tylko w granicach Kid API.
- `packages/kid-ui/src/screens/DeckScreen.tsx`, `packages/kid-ui/src/KidApp.tsx`, `packages/kid-ui/src/session/session-controller.ts` — karta zestawu i maszyna stanów; pokaż jawny start rundy przed sesją oraz jej podsumowanie/zakończenie bez opcji dokładania zwykłej nauki.
- `tests/integration/sessions.test.ts`, testy modułów lekcji i `packages/kid-ui/src/session/session-controller.test.ts` — wzorce testów blokad, retry, obietnicy końca, sesji słówek/lekcji i klienta.

## Tasks & Acceptance

**Execution:**
- [x] Kontrakty, schemat i migracja — rozróżnij rundę, zapisuj jej lokalny dzień i wymuś pojedynczy start na dziecko/dzień, zachowując możliwość wznowienia aktywnej sesji.
- [x] Planowanie sesji słówek, obrazu i lekcji — ogranicz pulę do bezpiecznych dzisiejszych kontaktów i do trzech wszystkich wydanych kroków bez obchodzenia istniejących reguł.
- [x] Kid API i UI — pokaż dobrowolny start rundy przed nauką, obsłuż krótszą/brakującą pulę oraz powrót po zakończeniu bez automatycznego dokładania zadań.
- [x] Testy RED–GREEN domeny/integracji/UI — sprawdź różne typy materiału, trzy wydania łącznie z kartami, retry, wznowienie, konkurencyjny start, nowy dzień, brak puli i zachowanie czasu/punktów.

**Acceptance Criteria:**
- Given dziecko ćwiczyło dziś zestaw, when wybiera rundę przed rozpoczęciem zwykłej nauki, then otrzymuje najwyżej trzy zadania z bezpiecznych dzisiejszych kontaktów i nie wybiera pytań samodzielnie.
- Given runda dobiera pomyłkę lub odpowiedź „Nie pamiętam”, when zadanie zostaje ocenione, then nie blokuje to nagrody za rozliczony czas i nie zmienia gwiazdek ani postępu opanowania.
- Given słówka, format obrazkowy lub lekcja, when silnik wydaje krok, then zachowuje istniejące zasady ujawniania, rezerwacji i samodzielności, a każde widoczne zadanie, ekspozycja lub karta zużywa limit trzech.
- Given mniej niż trzy lub zero bezpiecznych kontaktów, when dziecko/rodzic odczytuje dostępność, then runda jest krótsza albo jawnie niedostępna, bez sztucznego materiału i blokowania zwykłej nauki.
- Given retry, równoległy start, wznowienie lub ponowny odczyt tego samego dnia, when runda jest aktywna albo już zakończona, then nie powstaje druga runda ani czwarte zadanie; nowy lokalny dzień może otrzymać nową rundę.
- Given zakończoną, przerwaną lub niedostępną rundę, when story 4 odczytuje dane dnia, then stan i fakty rundy są dostępne bez wnioskowania o oszustwie.

## Implementation Notes

Planning decisions: wybór zestawu należy do dziecka, bo A2 wskazuje „wybrany zestaw”; dzień licz według migawki strefy rodzinnej używanej przez rewards. Gdy w tym samym zestawie są kontakty z kilku wersji, wybierz najnowszą wersję ćwiczoną tego dnia i przypnij ją na całą rundę. „Do trzech zadań” obejmuje każde widoczne wydanie, w tym prezentacje i karty, żeby obietnica dziecku nie zależała od typu modułu. Story 4 konsumuje zapisaną historię rundy; ten zakres udostępnia fakty, ale nie buduje rodzicielskiego podglądu. Kid API zmienia wyłącznie kontrakt `/api/v1/kid`; integracja MCP `learning-overview` nie udostępnia Kid DTO ani trybu sesji, więc adapter, jego schemat i `SKILL.md` pozostają bez zmian. Dla pustej puli albo puli bez planowalnego kroku start zwraca `daily_round_unavailable`; czysty preflight słówek/lekcji działa wewnątrz transakcji i rollback nie zostawia rundy. Błędny feedback rundy jest tymczasowym wynikiem planera, aby umożliwić wsparcie w tej sesji; nie zapisuje assessments ani projekcji mastery.

TDD evidence: po wyłączeniu strażnika limitu całkowitych wydań test rundy lekcji otrzymał czwarte zadanie (RED); przywrócony warunek przeszedł test (GREEN). Niezależny review doprowadził do testów rzeczywistych kontaktów po dacie i wersji, odpowiedzi lekcji bez ocen/postępu, formatu obrazkowego, komunikatu o braku rundy oraz równoległych startów i wydań.

## Spec Change Log

## Review Triage Log

- blind-hunter — `packages/server/src/modules/daily-round.ts` — **false / reject**: Pula opiera się na dzisiejszych wydanych kontaktach, zgodnie z ledgerem sesji; brak filtra `mock_test` nie zmienia jego planu ani nie prowadzi rundy trybem kartkówki.
- blind-hunter — `packages/server/src/modules/daily-round.ts` — **false / reject**: Wydane zadania są trwałym śladem ujawnienia przed zwróceniem treści; historia niedokończonej sesji może więc być dzisiejszym kontaktem.
- blind-hunter — `packages/server/src/modules/sessions.ts` — **false / reject**: `startSession` blokuje wiersz profilu dziecka `FOR UPDATE`, więc drugi start sprawdza rezerwację po zakończeniu pierwszej transakcji.
- blind-hunter — `packages/server/src/modules/kid.ts`, `packages/server/src/modules/daily-round.ts` — **low / reject**: Lista zestawów wykonuje zapytanie na zestaw i czyta pełną historię, ale instancja jest rodzinna o małej liczbie zestawów; optymalizacja wymaga zmiany zapytania/indeksów bez wykazanego problemu w bieżącym użyciu.
- blind-hunter — `packages/kid-ui/src/screens/SummaryScreen.tsx` — **medium / patch**: Podsumowanie używa teraz neutralnego tytułu, więc pasuje również do ręcznie przerwanej rundy.
- blind-hunter — `packages/kid-ui/src/screens/DeckScreen.tsx` — **medium / patch**: Brak puli ukrywał rundę mimo jawnego kryterium jej niedostępności; dodano krótką informację dziecku i test UI.
- blind-hunter — `tests/integration/sessions.test.ts` — **medium / patch**: Brakowało testu rundy dla formatu obrazkowego; dodano test rzeczywistych kontaktów i zachowania mikrofonu/promptu.
- blind-hunter — `tests/integration/lesson-sessions.test.ts` — **medium / patch**: Dotychczasowy test używał syntetycznych kontaktów; rozszerzono go o zadania i ścieżkę odpowiedzi lekcji z weryfikacją limitu.
- blind-hunter — `tests/integration/sessions.test.ts` — **medium / patch**: Dodano równoległy start rundy i równoległe `nextTask`; test potwierdza wspólną sesję/zadanie bez duplikatów.
- verification-gap — `tests/integration/lesson-sessions.test.ts` — **medium / patch**: Dodano odpowiedź do ocenianego zadania w rundzie lekcji i asercje braku wpisu `assessments` oraz zmiany projekcji celu.
- verification-gap — `packages/server/src/modules/daily-round.ts` — **medium / patch**: Dodano test integracyjny z kontaktami z różnych dni i wersji, sprawdzający lokalny dzień oraz pulę przypiętej wersji.
- edge-case-hunter — `packages/server/src/modules/sessions.ts` — **false / reject**: Ścieżka drugiego startu nie dochodzi równolegle do unikalnego indeksu, ponieważ blokada wiersza dziecka serializuje sprawdzenie i zapis.
- edge-case-hunter — `packages/server/src/modules/kid.ts` — **false / reject**: Kid API udostępnia dostępność dziecku w tej story; dane historii są zapisywane dla późniejszego podglądu rodzica w story 4, zgodnie z granicą zamrożonej intencji.
- implementacja — `packages/server/src/modules/daily-round.ts` — **medium / patch**: Zadania z różnych wersji mogą mieć identyczny `issuedAt`; dodano deterministyczny tie-break po numerze wersji i test tego przypadku.
- blind-hunter-final — `packages/kid-ui/src/screens/DeckScreen.tsx` — **medium / patch**: Zmieniono nieprawdziwą obietnicę dostępności po wykorzystaniu rundy na neutralny tekst poprawny dla obu stanów.
- blind-hunter-final — `packages/server/src/modules/daily-round.ts` — **false / reject**: Tryb źródłowej sesji nie zmienia trybu ani planu rundy; dzisiejszy wydany kontakt może pochodzić z dowolnej nauki zestawu.
- blind-hunter-final — `packages/server/src/modules/sessions.ts`, `tests/integration/lesson-sessions.test.ts` — **medium / patch**: Czysty preflight obu planerów odrzuca nieplanowalną pulę wewnątrz transakcji; test lekcji potwierdza rollback i brak wiersza rundy.
- blind-hunter-final — `packages/server/src/modules/daily-round.ts` — **low / reject**: Skan historii po dziecku i zestawie może rosnąć z czasem, lecz aplikacja rodzinna ma małą liczbę zestawów; brak dowodu na codzienny problem, a ograniczenie zapytania wymaga zmian w SQL i obsługi stref/DST.
- blind-hunter-final — `packages/server/src/modules/kid.ts` — **low / reject**: Odczyt dostępności jest sekwencyjny per zestaw i dubluje zapytania; mała rodzinna skala nie uzasadnia teraz zbiorczej optymalizacji całego odczytu.
- blind-hunter-final — `packages/server/src/modules/daily-round.ts` — **false / reject**: Pula liczy unikalne rewizje jako różne kontakty, co daje bezpieczną krótszą rundę przy powtórkach; kryteria wymagają różnych kontaktów, nie premiują ponownego pokazania tej samej rewizji.
- blind-hunter-final — `packages/server/src/modules/daily-round.ts` — **false / reject**: Przy większej puli implementacja wybiera trzy najnowsze różne rewizje; kryterium nie narzuca rankingu, a wybór jest deterministyczny.
- blind-hunter-final — `tests/integration/sessions.test.ts` — **medium / patch**: Test małej puli używa teraz publicznego `submitAttempt(..., modality: "skip")` zamiast modyfikować rekord bezpośrednio.
- blind-hunter-final — `tests/integration/lesson-sessions.test.ts` — **low / patch**: Test odpowiedzi wybiera teraz wariant inny od klucza, żeby jawnie sprawdzać błędną odpowiedź.
- blind-hunter-final — `spec-3-krotka-zapowiedziana-runda-dnia.md` — **medium / patch**: Uzupełniono wynik integracji i typowania weryfikacji po zakończeniu kontroli.
- verification-gap-final — `tests/integration/sessions.test.ts` — **medium / patch**: Test listy zestawów sprawdza `dailyRoundAvailable` jako true po dzisiejszych kontaktach i false po starcie rundy.
- edge-case-hunter-final — `packages/server/src/modules/attempts.ts`, `packages/server/src/modules/lessons/lesson-sessions.ts` — **medium / patch**: Odpowiedzi rundy nie mają assessments, więc planery nie widziały błędów do bieżącego wsparcia; przekazano feedback jako wynik tylko dla planowania sesji, bez zmiany historii i mastery.

- blind-hunter-review-fix — `packages/server/src/modules/sessions.ts` — **medium / patch**: Zapytanie planera dołącza `sessionTasks.exerciseType`; pełny typecheck przechodzi.
- edge-case-hunter-review-fix — `packages/server/src/domain/feedback.ts`, `packages/server/src/modules/attempts.ts`, `packages/server/src/modules/sessions.ts` — **medium / patch**: Jedna lista błędnego feedbacku (`incorrect`, `spelling_hint`, `capitalization_hint`, `almost`, `lesson_hint`, `lesson_almost`) steruje retry i wynikami planera; sukcesy i brak oceny są neutralne. Test jednostkowy sprawdza klasyfikację, a integracje rundy przechodzą.

## Design Notes

Runda musi być osobnym trybem/snapshotem, a nie `training` z mniejszym `taskBudget`: obecne wznawianie zależy od pary deck/tryb, a silnik liczy niektóre prezentacje poza budżetem ocenianym. Serwer zapisuje rezerwację dnia i stan rundy atomowo ze startem sesji; każde `next` respektuje ten sam limit wszystkich wydań.

## Verification

**Commands:**
- `node_modules/.bin/vitest.cmd run --config vitest.unit.config.ts packages/contracts/src/kid-lesson.test.ts packages/kid-ui/src/screens/deck-cover.test.tsx packages/kid-ui/src/screens/reward-summary.test.tsx packages/kid-ui/src/session/session-controller.test.ts packages/server/src/domain/feedback.test.ts` — 5 plików, 126 testów passed.
- `node_modules/.bin/vitest.cmd run --config vitest.integration.config.ts tests/integration/sessions.test.ts tests/integration/lesson-sessions.test.ts` — 2 pliki, 64 testy passed.
- `corepack pnpm typecheck` — wszystkie 6 konfiguracji TypeScript bez błędów.
- `git diff --check` — passed.

## Wycofanie (2026-10-17)

Właściciel wycofał funkcję rundy dnia. Migracja 0016 kończy istniejące aktywne rundy bez rozliczania oczekujących segmentów; historia i odczyt historycznego trybu pozostają zachowane. Zastąpiona przez spec-usuniecie-rundy-i-szybkie-zestawy.md.
