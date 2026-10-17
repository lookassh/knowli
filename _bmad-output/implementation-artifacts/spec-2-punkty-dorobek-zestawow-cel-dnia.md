---
title: 'Punkty, dorobek zestawów i cel dnia'
type: 'feature'
created: '2026-10-16'
status: 'done'
route: 'dispatch'
baseline_commit: '0ad8a2939705cad93297f37ba4e799af0f0f2d22'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/reward-rules.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/activity-policy.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/acceptance-scenarios.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-zaliczanie-aktywnego-czasu-nauki.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Umiem! zapisuje już serwerowo rozliczony czas aktywnej pracy, ale dziecko nie widzi z niego punktów, dorobku zestawów ani postępu do celu dnia. Gwiazdki pozostają oceną wiedzy i nie mogą pełnić roli waluty.

**Approach:** Naliczaj jeden punkt za każde pełne 60 sekund rozliczonej pracy, przenosząc resztę między krótkimi sesjami. Pokaż dziecku punkty przy zestawie, łączny dorobek i postęp do 30 minut w profilu oraz faktyczny przyrost po sesji; wylicz też gotowe pakiety Xbox bez ich wymiany.

## Boundaries & Constraints

**Always:** Korzystaj wyłącznie z serwerowo rozliczonych odcinków story 1, przypiętych do dziecka, sesji i stabilnego `deckId`. Zachowuj historyczny przydział punktów: reszta minut przechodzi przez sesje i zestawy, a punkt przypada zestawowi, którego rozliczenie domyka kolejne 60 sekund. Rozliczenie punktów jest idempotentne, trwałe i atomowe; sumy zestawów składają się na dorobek dziecka. Cel dnia liczy dokładne sekundy do 1800, według strefy rodziny utrwalonej dla sesji, z prawidłowym podziałem przez północ i DST. Zmiany publikacji, archiwizacja i przerwa nie zerują dorobku; usunięcie profilu usuwa jego dane nagrodowe. Pokaż punkty niezależnie od gwiazdek, poprawności, pomocy i mikrofonu. Interfejs używa wspólnego polskiego katalogu komunikatów.

**Never:** Nie używaj raportowej `learningTime`/MCP ani danych klienta jako źródła punktów. Nie naliczaj punktów za samo zakończenie sesji i nie zaokrąglaj osobno sesji lub zestawów. Nie zmieniaj ocen, gwiazdek, harmonogramu nauki ani znaczenia czasu raportowego. Nie implementuj wymiany, rezerwacji/zużywania punktów, automatyzacji Xbox ani podglądu rodzica (osobne story); brak historycznego backfillu.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Carry remainder | 30 s w sesji A, 30 s w sesji B | Łącznie 1 punkt; przypisany zestawowi B, bez podwójnego naliczenia po retry | Odrzuć nieautorytatywne lub powtórzone rozliczenie |
| Daily threshold | 1799 s, następnie 1800 s w lokalnym dniu | Cel pozostaje nieosiągnięty, a potem pokazuje 30/30 min i jeden gotowy pakiet | Nie zaokrąglaj przed progiem |
| Invalid/unsettled activity | Otwarte zadanie, skip albo brak zaakceptowanego kroku | Brak czasu i punktów | Stan neutralny; brak lokalnego sukcesu |

</frozen-after-approval>

## Code Map

- `packages/server/src/modules/reward-activity.ts` — `settleRewardActivity` przenosi zaakceptowane segmenty do rozliczeń; `readRewardActivitySummary` jest obecnie chronionym odczytem rodzica, nie źródłem punktów dla klienta.
- `packages/server/src/db/schema.ts`, `packages/server/drizzle/0012_reward_activity.sql` — wzorce trwałych segmentów i settlementów; sesja przypina `deckId`, a `context.timezone` utrwala strefę.
- `packages/server/src/modules/sessions.ts` — tworzy migawkę strefy, kończy sesję i zapisuje podsumowanie; punktowy przyrost podsumowania musi pochodzić z serwera.
- `packages/server/src/modules/kid.ts`, `apps/web/src/kid/kid-router.ts` — kontrakty profili, przypisanych zestawów i sesji dziecka.
- `packages/contracts/src/kid.ts`, `packages/contracts/src/messages.ts` — ścisłe DTO Kid API i współdzielone polskie teksty.
- `packages/kid-ui/src/screens/ProfileScreen.tsx`, `DeckScreen.tsx`, `SummaryScreen.tsx` — miejsca pokazania celu/dorobku profilu, punktów zestawu i przyrostu sesji; gwiazdki w `DeckScreen` opisują opanowanie.
- `tests/integration/reward-activity.test.ts`, `packages/server/src/domain/reward-activity.test.ts`, testy `packages/kid-ui/src/screens/` — istniejące wzorce dla settled activity, domenowych przedziałów i renderowania.

## Tasks & Acceptance

**Execution:**
- [x] `packages/server/src/db/schema.ts` i nowa migracja Drizzle — utrwalaj idempotentny przydział punktów na settlement oraz stabilny zestaw/stan reszty, bez backfillu punktów.
- [x] `packages/server/src/modules/reward-activity.ts` i `packages/server/src/domain/` — atomowo przydzielaj punkty tylko po settlement; agreguj dorobek profilu/zestawu oraz dzienny czas z migawką strefy i obsługą DST.
- [x] `packages/contracts/src/kid.ts`, `packages/server/src/modules/kid.ts`, `packages/server/src/modules/sessions.ts`, `apps/web/src/kid/kid-router.ts` — udostępnij profile, punkty zestawów, postęp dnia, dostępne pakiety oraz rzeczywisty przyrost sesji; nie przyjmuj kwot od klienta.
- [x] `packages/kid-ui/src/screens/{ProfileScreen,DeckScreen,SummaryScreen}.tsx`, `packages/contracts/src/messages.ts` i testy — pokaż krótkie polskie komunikaty, oddziel punkty od gwiazdek i sprawdź także przyrost zerowy.
- [x] Testy domeny, kontraktów i integracji — pokryj resztę minut, granice 59/60 i 1799/1800 s, zmianę dnia/DST, dwa zestawy, retry, usunięcie profilu i zgodność MCP bez zmiany jego znaczenia.

**Acceptance Criteria:**
- Given zaliczony czas w wielu sesjach i zestawach, when serwer przydziela punkty, then każde pełne 60 sekund daje punkt, reszta przechodzi dalej, punkt trafia do zestawu domykającego minutę, a suma zestawów równa się dorobkowi dziecka.
- Given retry, podwójne zakończenie lub ponowiony odczyt, when rozliczenie jest przetwarzane, then czas i punkty pozostają naliczone najwyżej raz.
- Given różna poprawność, pomoc, gwiazdki lub wyłączony mikrofon, when zaliczony czas jest taki sam, then punkty są takie same i stan wiedzy pozostaje bez zmian.
- Given 1799, a następnie 1800 zaliczonych sekund lokalnego dnia, when dziecko ogląda profil, then widzi dokładny cel 30 minut i jeden gotowy pakiet po osiągnięciu progu.
- Given sesje z różnych lokalnych dni, północ, DST lub zmianę strefy, when system agreguje dzień, then nie łączy bloków z różnych dat i nie przelicza historii według nowej strefy.
- Given dziecko kończy sesję, when widzi podsumowanie, then otrzymuje rzeczywisty przyrost punktów/czasu, bez premii za koniec i bez twierdzenia o opanowaniu.
- Given usunięcie profilu albo publikację/archiwizację zestawu, when dorobek jest odczytany, then dane usuniętego profilu znikają, a pozostały dorobek zachowuje stabilną tożsamość zestawu.
- Given zmiana kontraktów Kid API, when sprawdzana jest integracja MCP i `SKILL.md`, then raport `learning-overview` pozostaje estymowany i nie obejmuje nagród ani czasu nagrodowego.

## Implementation Notes

Settlement przechowuje `deck_id`, zaliczone milisekundy, przyznane punkty, resztę do kolejnej minuty i strefę z migawki sesji. Rozliczenia dziecka są serializowane blokadą transakcyjną, a każda nowa nagroda wynika wyłącznie z segmentów przypiętych do nowego settlementu. Migracja `0013_reward_points.sql` przypina istniejącym, historycznym settlementom stabilne ID zestawu i strefę sesji, ale zostawia ich sekundy/punkty/resztę zerowe — nie wykonuje backfillu nagród. Dzienne sekundy są sumą rozliczonych przedziałów rozdzielonych według lokalnej daty i zapisanej strefy sesji; zmianę DST obsługują istniejące `localDateBounds`.

Widoki Kid API to tylko `profiles`, `decks` i koniec sesji. Nie zmieniono `learning-overview`, jego estymowanego czasu, JSON Schema MCP ani `skills/umiem-learning/SKILL.md`; `pnpm test:mcp` potwierdził zachowanie kontraktu klienta. Nie ma wymiany ani rezerwacji pakietów.

TDD: pierwsza próba `corepack pnpm test:unit -- packages/kid-ui/src/screens/reward-summary.test.tsx` pokazała oczekiwane braki w dwóch asercjach: punkty nie były pokazane przy zestawie, a podsumowanie nie zawierało rzeczywistego przyrostu. Argumenty po `--` zostały przekazane przez pnpm jako argumenty programu i test uruchomił całą unit suite: 1224 testy przeszły, a te 2 asercje zakończyły się RED. Minimalny GREEN dodał niezależną linię punktów w `DeckScreen` oraz przyrost sekund/punktów w `SummaryScreen`; następny celowany run przeszedł. Test profilu objął 1799/1800 sekund oraz widoczne sumy. Trzy niezależne review zakończyły się; wszystkie ustalenia są odnotowane i rozstrzygnięte poniżej.

## Spec Change Log

## Review Triage Log

- **medium — patch, resolved:** `readKidRewardSnapshot` grupuje dzienne sumy według strefy i daty, a dzisiejszy postęp odczytuje dla strefy rodziny.
- **low — patch, resolved:** Niepoprawna strefa z utrwalonego kontekstu przechodzi na `Europe/Warsaw`; test integracyjny obejmuje uszkodzony kontekst.
- **low — rejected:** Agregacja wszystkich settlementów w JavaScript rośnie z historią, ale aplikacja jest prywatna dla jednej rodziny, a liczba dzieci i zestawów pozostaje mała; przeniesienie sum do SQL nie poprawi typowego przebiegu na tyle, by uzasadnić dodatkową zmianę teraz.
- **low — rejected:** Odczyt wszystkich segmentów jest potrzebny do wyliczenia trwałych pakietów ze wszystkich lokalnych dni bez wygasania; przy rodzinnej skali ten koszt nie jest prawdopodobnym problemem w codziennym użyciu.
- **low — rejected:** `listKidProfiles` wykonuje trzy dodatkowe odczyty na profil, ale profile są pobierane raz na wejściu do UI, a typowa liczba profili rodzinnych jest mała; hurtowe API/projekcja byłyby nieproporcjonalne.
- **false — rejected:** `family_settings.id` jest kluczem głównym i ograniczeniem do wartości `1`, więc zapytanie z `limit(1)` nie może wybrać niejednoznacznego wiersza; brak wiersza korzysta z jawnego fallbacku strefy.
- **false — rejected:** Cel 1800 sekund jest stałym, zatwierdzonym wymaganiem story; literal w kontrakcie i polski tekst 30 minut pozostają zgodne, a konfigurowalny cel nie należy do tego zakresu.
- **false — rejected:** `pointsToUse` celowo może być mniejsze od `earnedPoints` po późniejszej wymianie w story 5; obecny serwer zwraca równe wartości i nie tworzy sprzecznego widoku.
- **low — patch, resolved:** Etykieta pakietów odmienia liczbę pojedynczą, mnogą i zbiorową; testy UI sprawdzają formy.
- **medium — patch, resolved:** Profil grupuje tożsamość i nagrody w zawijanym układzie, który mieści znaczniki na wąskich ekranach.
- **low — patch, resolved:** `rewardAward` sprawdza bezpieczeństwo sumy składników; test brzegowy obejmuje overflow.
- **low — patch, resolved:** Test integracyjny potwierdza `Cache-Control: no-store` dla tras profili i zestawów Kid API.

## Verification

**Commands (po poprawkach review):**
- `node_modules/.bin/vitest.cmd run --config vitest.unit.config.ts packages/server/src/domain/reward-activity.test.ts packages/kid-ui/src/screens/reward-summary.test.tsx packages/kid-ui/src/session/session-controller.test.ts apps/web/src/integrations/learning-mcp-route.test.ts` — 4 pliki, 83 testy przeszły.
- `node_modules/.bin/vitest.cmd run --config vitest.integration.config.ts tests/integration/reward-activity.test.ts tests/integration/learning-overview.test.ts` — 2 pliki, 7 testów przeszło.
- `node_modules/.bin/tsc.cmd --noEmit -p <project-tsconfig>` dla root, contracts, server, web, worker i kid-ui — wszystkie sześć projektów typuje się bez błędów.
- `git diff --check` — bez błędów; Git zgłosił wyłącznie ostrzeżenia o normalizacji CRLF.
- `pnpm typecheck` nie doszedł do kompilacji, ponieważ wrapper Codex uruchomił `pnpm install`, które przerwało usuwanie `node_modules` z powodu braku TTY; sprawdzenie typecheck wykonano bezpośrednio przez lokalne `tsc`.
