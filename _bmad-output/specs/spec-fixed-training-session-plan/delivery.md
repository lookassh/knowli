# Granice implementacji i odbioru

## Model i mapa kodu

Wykorzystać koncepcję prywatnego planu kartkówki (`packages/server/src/modules/mock-tests.ts`, `domain/mock-test-types.ts`), zachowując odrębny trening i natychmiastowy feedback. Nie kopiować odczytów per element ani nie zmieniać semantyki mock_test_plan.

| Obszar | Oczekiwana zmiana |
| --- | --- |
| `packages/server/src/domain/training-session-plan.ts` (nowy) | Czysty planer słówek: historia startowa, dostępność, chronione cele, skończone sloty i seed |
| `packages/server/src/domain/scheduler.ts` i moduły historii | Wspólne reguły bez pętli z fikcyjnymi ocenami; zachowanie sygnałów trudności między sesjami |
| `packages/server/src/modules/lessons/lesson-sessions.ts` | Plan lekcji za SubjectModule i regułami przedmiotu |
| `packages/server/src/db/schema.ts`, `packages/server/drizzle/` | Wersjonowany prywatny plan, migracja z niezmiennością i kaskadami profilu/sesji |
| `packages/server/src/modules/sessions.ts` | Start zbiera dane raz i zapisuje plan atomowo; next wydaje slot bez pełnej rekonstrukcji historii |
| `packages/server/src/modules/attempts.ts`, `modules/lessons/lesson-attempts.ts`, `modules/reward-activity.ts` | Ocena, kwalifikacja i rozliczenia bez dopisywania adaptacyjnych slotów |
| `packages/kid-ui/src/session/session-controller.ts`, `screens/LearnScreen.tsx`, `styles.css` | Natychmiastowy stan oczekiwania, neutralny wybór, stały układ i remaining po pominięciach |
| `packages/contracts/src/kid.ts`, `apps/web/src/kid/kid-router.ts` | Tylko niezbędne zmiany publicznego kontraktu, bez planu i kluczy w DTO |
| `docs/SPEC.md`, `docs/architecture.md`, `docs/implementation-plan.md` | Nowa reguła adaptacji między sesjami, protokół i wdrożenie |

Nowy plan jest niezmienny. Postęp wykonania wynika z wydanych/zamkniętych zadań i pominięć, bez mutowania treści listy. Zapis planu i wydanie slotu chroni istniejąca blokada sesji; restart nie wymaga pamięci procesu. Prezentacja nie tworzy próby/oceny.

Nowe treningi używają planu, aktywne stare kończą się dotychczasową ścieżką. Nie przepisywać promptów ani ocen. Serwer czyta stare sesje i własną wersję nowego planu. Kolejność: kompatybilna migracja → serwer obu wariantów → UI. Po przełączeniu stary writer nie może tworzyć nowych planów. Rollback uwzględnia istniejące nowe plany; stare binarium nie jest automatycznie zgodne.

API → MCP → skill sprawdzić w każdym zadaniu zmieniającym kontrakt lub znaczenie danych. learning-overview nie wystawia komend treningu, nadal wyklucza lekcje i nie liczy niewydanych slotów jako nauki. Gdy schema/semantyka raportu nie zmienia się, uzasadnić pozostawienie adaptera i skilla; gdy wpływ istnieje, uaktualnić je razem z kontraktami i testami. Zmiana repo nie aktualizuje instalacji Hermesa.

## Sprawdzenia przy implementacji

- Planer: seed, oba canRead, standard/picture, nowe i trudne słowa, historia sukcesów, singleton, brak dystraktorów/mikrofonu, skończona lista i budżet. Planowana prezentacja nie jest realną ekspozycją.
- Między sesjami: identyczny plan zachowuje kolejność przy różnych odpowiedziach, następna sesja reaguje na trudności i rozliczenie wsparcia; skip/awaria nie cofają wiedzy.
- PostgreSQL: atomic start, immutability, restart/reload, retry/dwie karty, jedno issued, brak podwójnych nagród, kwalifikacja po ujawnieniu w innej karcie, usunięcie profilu, legacy i migracja.
- Lekcje: SubjectModule, natychmiastowy feedback, processing/cache/model bez zmiany listy, wsparcie następnej sesji; raport Hermesa nadal bez lekcji.
- UI/e2e: kliknięcie, error/retry/offline, mikrofon, obietnica końca, stabilność całego widoku, mobile, klawiatura i zoom. Docelowe urządzenie wymaga rzeczywistego sprawdzenia; emulacja nie jest odbiorem fizycznego telefonu.

Po każdym zadaniu oraz po poprawkach review muszą przejść wszystkie unit/integration/e2e, typecheck i build. Dopiero potem pojedyncze niezależne review i commit według execution.md. Testy nie są odłożone do końca projektu. Nie zmieniać progów ani osłabiać testów, aby ukryć regresję.

## Pomiar skutku

Przed pierwszą zmianą implementacji zebrać baseline na tej samej instancji i fikcyjnych zestawach z krótką/długą historią. Ustalić niezmienny protokół: 5 rozgrzewek oraz co najmniej 30 próbek na wariant w każdej z 3 serii, identyczny materiał, tryb mikrofonu i warunki transportu. Zachować liczebność, wersję kodu, warunki i rozrzut wyników; ograniczenia środowiska opisać wprost.

Raportować p50/p95: start, next, complete, attempts, activity, blokady/SQL oraz kliknięcie→reakcja UI i kliknięcie→gotowy ekran. Strukturalnie next nie składa pełnego wejścia planera. Oczekiwany efekt to niższe p95 next i brak pogorszenia p95 całego przejścia; szumu pomiarowego nie uznawać za dowód poprawy. Start pokazać osobno, aby nie ukryć przeniesienia kosztu.

Cel reakcji UI ≤100 ms sprawdzić w kontrolowanym środowisku; odbiór na urządzeniu referencyjnym raportować osobno. Nie obiecywać usunięcia 1–2 s bez pomiaru przy pozostającym transporcie activity.

Dotychczasowe 96/96 testów dotyczyło starego kodu. Niniejsze dokumenty są przygotowaniem implementacji; nie zawierają deklaracji ukończenia kodu lub jego review.
