# AGENTS.md — Knowli / Umiem!

Instrukcje dla agentów pracujących w tym repozytorium. Umieść ten plik w katalogu głównym repozytorium.

## Tożsamość projektu i język

- Nazwa repozytorium i projektu technicznego: **Knowli**. Identyfikator repozytorium/katalogu: `knowli`.
- Polska nazwa aplikacji widoczna dla użytkownika: **Umiem!** — zachowuj wykrzyknik.
- Pierwsza wersja ma polski interfejs: `pl-PL`, w panelu rodzica i dziecka, komunikatach, błędach, onboarding oraz manifeście PWA. Nazwa aplikacji w manifeście: `Umiem!`.
- Angielski jest językiem materiału pierwszego modułu, a nie językiem interfejsu. Początkowa para języków materiału: `pl-PL` → `en-GB`.
- Kod, nazwy plików, identyfikatory, DTO, klucze API i tabel pisz po angielsku. Dokumentację projektu i komunikację z właścicielem pisz po polsku.
- Teksty interfejsu trzymaj w jednym prostym katalogu komunikatów współdzielonym przez odpowiednich klientów. Nie buduj teraz przełącznika języka ani rozbudowanego systemu tłumaczeń. Locale treści, wymowy i UI są osobnymi wartościami.
- Utrzymuj techniczne nazwy pakietów `@learning/*` przyjęte w architekturze; branding nie wymaga ich zmiany.

## Cel produktu

Prywatna, self-hostowana aplikacja rodzinna: rodzic określa materiał, AI przygotowuje zestaw, rodzic sprawdza i zatwierdza wynik, a dziecko uczy się podczas krótkich sesji. System pamięta próby i trudności konkretnego dziecka.

Pierwszy moduł to angielskie słownictwo dla początkującego dziecka w wieku około 8 lat. MVP obejmuje także przygotowanie do pisemnych sprawdzianów, profile dzieci i naukę bez mikrofonu. Priorytetem jest prostota i wiarygodne rozróżnienie nauki ze wsparciem od samodzielnego przypominania.

## Dokumenty i początek pracy

Przed zmianami przeczytaj dokumenty dotyczące zadania:

1. `docs/SPEC.md` — wymagania i kryteria akceptacji, wersja bazowa 1.1.
2. `docs/architecture.md` — decyzje i kontrakty, wersja bazowa 1.2 po review.
3. `docs/schema.sql` — początkowy projekt bazy, wersja bazowa 1.2.
4. `docs/folder-structure.md` — uzgodnione granice i ścieżki.
5. `docs/implementation-plan.md` — małe zadania, zależności oraz regresje R01–R07.

W początkowym repo umieść powyższe dokumenty w `docs/`. Ten plik uzupełnia je o zasady pracy i branding. Nie zastępuje szczegółowych wymagań ani uzgodnionych kontraktów. Aktualne polecenia właściciela mają pierwszeństwo; istotne nowe ustalenia odzwierciedlaj w dokumentacji.

Na początku sprawdź stan repozytorium, istniejące skrypty i zakres zmian użytkownika. Nie nadpisuj jego niezwiązanych zmian. W razie sprzeczności wpływającej na model danych, prywatność lub publiczny kontrakt wyjaśnij ją przed implementacją zależnego fragmentu. Rutynowe wybory rozstrzygaj samodzielnie.

## Architektura i stack

- Next.js App Router, React i TypeScript w trybie strict; runtime serwera Node.js.
- PostgreSQL, Drizzle ORM i Drizzle Kit; Zod do walidacji granic i wyników AI.
- Tailwind CSS, PWA, pnpm workspaces, Vitest i Playwright.
- Modularny monolit w jednym repozytorium: proces `web`, proces `worker`, jedna baza PostgreSQL. Kolejka Graphile Worker korzysta z tej samej instancji bazy.
- Docker Compose/Coolify, prywatny trwały wolumen mediów; konkretne stabilne wersje przypnij podczas implementacji.

Granice kodu:

| Ścieżka | Odpowiedzialność |
| --- | --- |
| `apps/web` | Next.js: panel rodzica, host Kid UI i cienkie endpointy API |
| `apps/worker` | Długie zadania przygotowania materiałów |
| `packages/contracts` | Publiczne DTO, schematy Zod i typy bez sekretów |
| `packages/kid-ui` | Przenośny interfejs dziecka w React |
| `packages/server` | Domena, przypadki użycia, baza i adaptery providerów |

Kid UI używa jawnego `/api/v1/kid` i konfigurowalnego `baseUrl`. Nie importuje Next.js, Server Actions, bazy ani kodu serwerowego. Mikrofon, odtwarzanie i lokalne ustawienia mają adaptery platformowe. Dzięki temu przyszły host Capacitor może ponownie wykorzystać interfejs; nie buduj teraz aplikacji Android.

SDK dostawców występują tylko w adapterach za portami LLM, TTS, STT, pronunciation, images i mediów. Domena nie zna Azure/OpenAI. Nie wywołuj LLM przy każdym kliknięciu; generuje materiał, a sesję prowadzą jawne reguły serwera.

Nie dodawaj mikroserwisów, Redis, osobnego backendu, ogólnego frameworka pluginów ani abstrakcji repozytorium dla każdej tabeli.

## Zasady danych i uczenia

- Opublikowana treść jest niezmienna. Edycja tworzy nowy szkic; sesja przypina wersję zestawu i polityki.
- Oddzielaj `learning_item`, `item_revision` i `skill_version`. Postęp jest osobny dla dziecka i umiejętności: listening, reading, recall, pronunciation, spelling. Stara próba nie awansuje nowych kryteriów.
- Historia prób, ocen i ekspozycji jest źródłem danych; liczniki postępu są odtwarzalną projekcją. Nie przepisuj zakończonych ocen. Usunięcie profilu usuwa jego historię i transkrypcje, zachowując wspólny materiał.
- Serwer zapisuje i zamyka komplet ekspozycji **przed** wysłaniem ujawnianej treści. Dotyczy to podpowiedzi, dystraktorów, feedbacku, retry i ponownego odsłuchu z cache. ACK klienta jest opcjonalną obserwacją.
- Operacje sesji wszystkich klientów podlegają tej samej blokadzie. Kontekst kwalifikacji próby zamraża się przy `received_at`, przed analizą mowy.
- Wydane zadanie ma niezmienny prompt, klucz odpowiedzi i kontekst. Exposure kończy się idempotentnym `complete-presentation`, bez próby, oceny i zużycia budżetu ocenianych zadań.
- Scheduler chroni cele należnych samodzielnych sprawdzeń przed wcześniejszym ujawnieniem, także jako dystraktory. Jedna samodzielna odpowiedź pisemna może oceniać Recall i pisownię oddzielnie.
- Zwykłe STT sprawdza treść, a osobny provider ocenia wymowę. Zatwierdzone warianty odpowiedzi są poprawne także w mowie. Wyniku wymowy dla innego wariantu nie przenoś na wypowiedziany tekst.
- Parametry startowe polityki: 300 sekund od ujawnienia dla samodzielnego Recall/pisowni, trzy ostatnie kwalifikujące sukcesy, potwierdzenie innego dnia po minimum 12 godzinach, wsparcie po dwóch błędach. Szczegóły i wyjątki stosuj zgodnie ze SPEC i architekturą.
- „Nie pamiętam” jest trudnością. „Pomiń”, cisza, niepewne rozpoznanie i awaria techniczna nie są dowodem błędnej wiedzy. Niepewny STT nie tworzy pomyłki między słowami.

## Generowanie, media i prywatność

- Waliduj structured output AI po stronie serwera. Materiał dostępny dziecku wymaga zatwierdzenia rodzica.
- TTS generuj i cache'uj podczas przygotowania materiału. Gotowy rekord zasobu i jego bajty są niezmienne; ręczna regeneracja tworzy nowy zasób/generację.
- Media job jest związany z `asset_id`, a nie numerem edycji całego szkicu. Lease należy do współdzielonego zasobu. Każda edycja uzgadnia fingerprinty, zachowuje zgodne media i zleca brakujące w tej samej transakcji.
- `MediaStore.putImmutable` zapisuje bez nadpisywania istniejącego blobu. Spóźniony worker nie może zmienić gotowych mediów ani powiązań szkicu.
- Nagranie dziecka przetwarzaj krótkotrwale w pamięci. Nie zapisuj go w bazie, kolejce, plikach tymczasowych, logach, fixture ani backupie. Zwolnij mikrofon i bufory także po błędzie/anulowaniu.
- Sekrety pozostają na serwerze. Kid DTO nie zawiera klucza odpowiedzi, kryteriów oceny ani technicznych score'ów. Nie serializuj bezpośrednio rekordów bazy.
- Parent Mode wymaga PIN-u/hasła, sesji i serwerowej autoryzacji każdej operacji. Wybór profilu dziecka nie jest mechanizmem zabezpieczenia publicznej instancji.
- Sposób dostępu spoza domu wymaga osobnego ustalenia przed publicznym wystawieniem. Nie twórz teraz platformy wielorodzinnej.

## UX pierwszej wersji

- Polski tekst ma być krótki, naturalny i zrozumiały dla dziecka. Duże pola dotykowe, jeden jasny krok, mobile first i tablet friendly.
- Przykłady feedbacku: „Świetnie!”, „Prawie! Posłuchaj jeszcze raz”, „Spróbuj jeszcze raz”. Feedback musi odpowiadać rzeczywistemu wynikowi; nie chwal błędnej odpowiedzi jako poprawnej.
- Sesje trwają około 5–10 minut. Po „Jeszcze 3 i koniec!” nie dokładaj zadań ponad obiecany budżet.
- Dziecko nie widzi modeli, promptów, procentowych ocen, konfiguracji powtórek ani administracji.
- Rodzic ma prosty podgląd materiału, edycję, przypisania i postęp per umiejętność. Obraz pomaga w znaczeniu: object/action, a kolor/liczba/sekwencja korzystają z renderowania deterministycznego.
- Nauka bez mikrofonu jest pełnoprawną ścieżką. Odmowa uprawnienia nie blokuje sesji. PWA nie obiecuje nauki offline; utrata sieci nie może tworzyć lokalnie fałszywego sukcesu.

## Sposób implementacji i sprawdzania

- Przed rozpoczęciem zadania dobierz i uruchom skillsy Superpowers zgodnie z tabelą i bramkami poniżej. Dotyczy to każdego agenta pracującego w repozytorium, w tym Codex i Zcode. Polecenia właściciela i instrukcje tego pliku mają pierwszeństwo.
- Realizuj uzgodniony plan małymi zadaniami z działającym, sprawdzalnym rezultatem. Nie traktuj odczytania tego pliku jako polecenia zbudowania całego MVP.
- Próbę mowy i mediów wykonaj zgodnie z zadaniem 0. Bez kluczy lub docelowego urządzenia opisz brakujące dowody; tekstowy fundament może powstawać dalej. Nie deklaruj gotowej oceny wymowy bez tej próby.
- Nie dodawaj funkcji poza aktualnym zadaniem. Deleguj pracę innym agentom tylko po wyraźnej zgodzie użytkownika.
- Dla reguł oceny, historii, współbieżności i danych dodawaj znaczące testy. Testy domeny używają kontrolowanego zegara, integracyjne docelowego PostgreSQL, a providerów w testach zastępują fake-adaptery.
- Pokryj odpowiednie regresje R01–R07 z planu; weryfikuj awarie, retry, dwie przeglądarki i usuwanie profilu, nie tylko poprawny przebieg.
- Uruchamiaj istniejące skrypty adekwatne do zmiany. Planowane komendy: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`. Najpierw sprawdź `package.json`; nie twierdź, że skrypty już istnieją.
- Początkowy SQL jest projektem do odwzorowania. Po wdrożeniu Drizzle utrzymuj autorytatywny schemat TypeScript i przeglądane migracje SQL, w tym wymagane triggery; nie rozwijaj niezależnie dwóch definicji.
- Aktualizuj dokumentację, gdy zmienia się uzgodniony kontrakt lub decyzja. Raportuj co zmieniono, co rzeczywiście sprawdzono i co pozostaje niezweryfikowane. Sprawdzenia SQL w PGlite nie są testami gotowej aplikacji.
- Lokalnie dostępne jest narzędzie GitHub CLI (`gh`, w razie braku w `PATH` bieżącej powłoki: `C:\Program Files\GitHub CLI\gh.exe`) z aktywnym uwierzytelnieniem. Agenci mogą z niego korzystać (np. do sprawdzania stanu repozytorium, statusu PR czy tworzenia PR w ramach autoryzowanego workflow). Pamiętaj, że samo istnienie narzędzia nie uprawnia do samodzielnego push do `main`, scalania PR ani otwierania PR poza workflow opisanym w sekcji „Integracja do `main` — zawsze Pull Request ze squash”.

### Obowiązkowe wykonanie workflow Superpowers

Poniższe reguły opierają się na [workflow Superpowers](https://github.com/obra/superpowers#the-basic-workflow), a bramki wykonania i review są wymaganiami tego repozytorium. Czytaj aktualne, dostępne w danym środowisku `SKILL.md`; nie polegaj na pamięci nazwy ani starej wersji workflow.

- Jeżeli środowisko ma narzędzie wywoływania skillsów, użyj go. Jeżeli udostępnia skillsy jako pliki, otwórz właściwy `SKILL.md` i wykonaj jego instrukcje. Nie zakładaj, że instalacja w jednym kliencie oznacza dostępność w drugim.
- Przeczytanie lub wymienienie skilla nie oznacza wykonania jego workflow. Zapowiedz używany skill i jego cel, a przed implementacją utwórz i aktualizuj checklistę wymaganych kroków, artefaktów oraz zatwierdzeń.
- Jeśli potrzebny skill jest niedostępny, zgłoś jego nazwę, brak i wpływ na zadanie. Nie deklaruj jego użycia ani nie zastępuj go po cichu własnym procesem. Wykonuj dalej niezależne, autoryzowane czynności; brak skilla nie jest zgodą na pominięcie wymaganej bramki.

#### Kiedy uruchamiać poszczególne skillsy

Nazwy w tabeli oznaczają skillsy `superpowers:<nazwa>`; prefiks wywołania może zależeć od klienta.

| Sytuacja / moment | Wymagany skill i rezultat |
| --- | --- |
| Początek nowego zadania lub rozmowy | `using-superpowers`: sprawdzenie pasujących skillsów przed działaniem i wybór workflow. |
| Nowa funkcja, projektowanie lub zmiana zachowania aplikacji | `brainstorming`: klasyfikacja zakresu, projekt i zatwierdzenia wymagane przez wybraną ścieżkę. |
| Zatwierdzone wymagania wymagające wieloetapowej implementacji | `writing-plans`: zapisany plan z plikami, zadaniami, testami, kryteriami ukończenia i wskazanym sposobem wykonania. |
| Rozpoczęcie lub wznowienie wykonania istniejącego planu przez bieżącego agenta | **`executing-plans`**: obowiązkowo przed pierwszą zmianą implementacyjną; dotyczy także planów z wcześniejszego czatu lub przygotowanych przez innego agenta. |
| Implementacja planu przez delegowanych wykonawców | `subagent-driven-development`: tylko po wyraźnej zgodzie właściciela na ten tryb; review zgodności ze specyfikacją i jakości po każdym zadaniu. |
| Co najmniej dwa niezależne zadania do delegacji równoległej | `dispatching-parallel-agents`: tylko po wyraźnej zgodzie właściciela i sprawdzeniu braku wspólnego stanu lub zależności. |
| Błąd, nieoczekiwane zachowanie lub nieudany test | `systematic-debugging`: ustalenie i potwierdzenie przyczyny przed proponowaniem poprawki. |
| Implementacja zachowania lub poprawka błędu | `test-driven-development`: znaczący test, potwierdzone RED, minimalna implementacja i GREEN. |
| Początek implementacji wymagającej izolacji lub wykonania planu | `using-git-worktrees`: utworzenie albo sprawdzenie istniejącego worktree; nie twórz kolejnego bez potrzeby. |
| Ukończenie uzgodnionego zakresu implementacji, duża funkcja/refaktoryzacja, złożona poprawka oraz przed scaleniem do `main` | **`requesting-code-review`**: osobny przegląd zmian z wymaganiami, zakresem diffu i wynikami sprawdzeń; szczegóły bramki poniżej. |
| Otrzymanie uwag z review | `receiving-code-review`: weryfikacja techniczna uwag przed zmianami; uzasadnione przyjęcie lub odrzucenie. |
| Przed stwierdzeniem „gotowe”, „naprawione”, „testy przechodzą”, commitem lub PR | `verification-before-completion`: aktualne polecenia, odczytane wyniki i sprawdzone kryteria akceptacji. |
| Zakończenie gałęzi implementacyjnej, integracja lub sprzątanie po niej | `finishing-a-development-branch`: weryfikacja, zawsze PR do `main` (scala właściciel, Squash and merge) i odpowiednie sprzątnięcie. |

#### Bramka plan → wykonanie: `executing-plans`

- Klasyfikuj zadanie według całego zakresu zmian. Zmiana publicznego DTO/API, modelu danych lub współpracy klient–serwer wymaga ścieżki architectural. Nie traktuj jej jako bounded tylko dlatego, że widoczny efekt dotyczy jednego ekranu. Zachowaj wymagane przez `brainstorming` etapy zatwierdzania projektu, zapisanej specyfikacji i planu; zatwierdzenie jednego etapu nie zatwierdza następnego.
- Gdy zatwierdzony plan ma być wykonywany przez bieżącego agenta, **uruchom `executing-plans`, zanim zaczniesz implementację**. Samo przeczytanie planu, wypisanie TODO albo użycie `writing-plans` nie spełnia tej bramki. Polecenia „zrealizuj plan”, „kontynuuj plan” i „wdroż zadanie N z planu” są wyzwalaczami tego skilla; nie wymagają wymienienia go przez właściciela.
- Domyślnym trybem w tym repo jest wykonanie przez bieżącego agenta. Istnienie narzędzi multi-agent nie uprawnia do delegacji. Jeśli właściciel zatwierdził plan i polecił jego wykonanie w tym czacie, zastosuj `executing-plans`; nie pytaj ponownie o już zaakceptowany tryb. `subagent-driven-development` jest alternatywą dopiero po wyraźnej zgodzie na delegację.
- Nowy plan zapisz w `docs/superpowers/plans/` i dodaj instrukcję dla kolejnego agenta: „REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.” Starszy plan bez takiego nagłówka nadal podlega tej bramce.
- Wykonaj setup skilla: sprawdź izolację, przeczytaj plan i specyfikację, sprawdź zależności między zadaniami i załóż albo wznów dziennik postępu przypisany do tego planu. Korzystaj ze skryptów workspace/task-start/task-done/review-package wskazanych przez zainstalowaną wersję. Jeżeli wymagają dostosowania do platformy, zapisz powód i równoważne kroki z tymi samymi artefaktami oraz dowodami; nie pomijaj ich rezultatów.
- Przy każdym zadaniu zapisz wymagane sprawdzenia, rzeczywiste wyniki i odstępstwa wraz z uzasadnieniem. Po wznowieniu lub kompakcji sprawdź dziennik oraz Git i wróć do pierwszego niezakończonego zadania. Nie wykonuj ponownie ukończonych zadań i nie oznaczaj kolejnych jako gotowych bez dowodów.
- Kontynuuj autoryzowane zadania bez pytania „czy iść dalej?” po każdym kroku. Nowe ustalenia wpływające na dane, prywatność lub publiczny kontrakt wyjaśnij zgodnie z zasadami początku pracy.
- Wykonanie planu kończy się review **całego uzgodnionego zakresu zmian** przez `requesting-code-review`, a potem workflow `finishing-a-development-branch`. Review pojedynczego ostatniego commita nie wystarcza dla planu obejmującego kilka commitów.

#### Bramka implementacja → review: `requesting-code-review`

- **Uruchom `requesting-code-review` przed raportem o ukończeniu implementacji oraz zawsze przed utworzeniem PR, a więc i przed każdym scaleniem do `main` — review poprzedza PR, nie idzie za nim.** W tym repo dotyczy to także zadań zmieniających testy, migracje, konfigurację wykonawczą lub zabezpieczenia. Nie odkładaj review do chwili, gdy właściciel sam o nie poprosi.
- Przy `executing-plans` wykonaj jeden końcowy przegląd całego zakresu. Przy autoryzowanym `subagent-driven-development` wykonuj przeglądy wymagane po każdym zadaniu i końcowy przegląd całości. Nie dodawaj automatycznie recenzenta do każdego kroku wykonywanego inline.
- Przygotuj kontekst zgodnie z `requesting-code-review/code-reviewer.md`: cel i wymagania, ścieżki specyfikacji oraz planu, `Review Focus`, zakres zmian `BASE_SHA..HEAD_SHA`, wyniki testów oraz decyzje/odstępstwa z dziennika. Bazę dobierz do całego zadania, nie automatycznie `HEAD~1`. Jeśli są niezacommitowane zmiany, dołącz ich diff, aby review obejmowało faktyczny stan dostarczanej pracy.
- W osobnym przeglądzie sprawdź zgodność z wymaganiami, regresje, granice pakietów, prywatność, współbieżność i awarie odpowiednie dla zadania. Przejście testów ani wcześniejszy przegląd planu nie zastępują review implementacji.
- Zweryfikuj uwagi przy użyciu `receiving-code-review`. Rozwiąż Critical i Important przed uznaniem zakresu za gotowy; odrzucone uwagi uzasadnij dowodami. Minor zapisz jako odłożone. Poprawki zachowania wymagają potwierdzonego RED→GREEN oraz odpowiednich sprawdzeń regresji.
- Zachowaj wynik review i działania po uwagach w dzienniku/checkliście. Raport końcowy musi wskazywać, co objął przegląd, czy był niezależny czy własny, oraz jakie uwagi lub ograniczenia pozostały.

#### Integracja do `main` — zawsze Pull Request ze squash

- **Po ukończeniu zakresu pracy (skill `finishing-a-development-branch`) zawsze wypychaj gałąź roboczą do origin i twórz Pull Request do `main` — to standardowy koniec każdego zadania, nie krok opcjonalny.** Opcja „Merge back to `<base-branch>` locally" z menu skilla nie stosuje się w tym repo bez wyraźnego polecenia właściciela. Wypchnięcie gałęzi roboczej i otwarcie PR w ramach tego workflow jest autoryzowane; brak odpowiedzi właściciela na menu integracji nigdy nie jest zgodą na samodzielne scalanie.
- **Niezależny review obowiązkowo poprzedza PR** — bramka `requesting-code-review` wykonana przez dedykowanego subagenta-recenzenta wg szablonu `requesting-code-review/code-reviewer.md`, obejmująca cały zakres zmian gałęzi, a nie przegląd własny. Rozwiąż Critical i Important (`receiving-code-review`) **przed** utworzeniem PR, a wynik review i obsługę uwag zawrzyj w opisie PR. PR bez udokumentowanego niezależnego review nie spełnia bramki.
- PR scala właściciel. Agent może scalić PR tylko na wyraźne polecenie właściciela (wtedy wyłącznie **Squash and merge**).
- **Scalaj wyłącznie przez Squash and merge** — zmiany jednego feature'u wykonane w worktree lub na gałęzi roboczej lądują na `main` jako jeden squash commit; drobne commity implementacyjne, TDD i poprawki po review pozostają historią gałęzi roboczej, a na `main` ma być czytelna historia ukończonych feature'ów. Nie przenoś wszystkich commitów feature'u przez merge commit, fast-forward ani rebase merge.
- Wiadomość squash commita opisuje końcowy rezultat całego feature'u, a nie ostatni krok lub listę roboczych commitów. Użyj właściwego typu, np. `feat: <opis funkcji>` albo `fix: <opis poprawki>`, i w razie potrzeby dodaj istotne szczegóły oraz weryfikację w treści.
- Zachowaj commity i dziennik wymagane podczas wykonywania planu; squash jest krokiem integracji, nie powodem do pomijania historii pracy. Wykonaj wymagane review oraz sprawdzenia przed scaleniem PR, a po scaleniu sprawdź wynik na `main` przed sprzątnięciem gałęzi/worktree. Po squash potwierdź włączenie zmian na podstawie ich treści; same SHA commitów gałęzi roboczej nie będą przodkami `main`.
- Reguła określa sposób przyszłych scaleń; nie uprawnia do samodzielnego scalania PR, push do `main` ani przepisywania istniejącej historii `main`.

#### Weryfikacja i wyjątki

- Przy TDD uruchom test nowego zachowania przed napisaniem odpowiadającego mu kodu i potwierdź oczekiwaną porażkę. Późniejsze przejście testów nie zastępuje dowodu RED.
- Sama zmiana dokumentacji bez zmiany zachowania aplikacji nie wymaga tworzenia specyfikacji, planu implementacji ani sztucznego testu RED. Sprawdź treść, odnośniki, spójność instrukcji i `git diff --check`. Wyjątek dotyczy tylko specyfikacji, planu i testu RED — niezależny review przed PR pozostaje obowiązkowy; przegląd własny dokumentu opisz jako dodatkowy, jeśli go wykonujesz. Jeśli zadanie obejmuje również kod lub kontrakty produktu, obowiązuje workflow całego zakresu.
- Gdy pracujesz w worktree (lub na gałęzi roboczej), kończenie pracy wykonuj skillem `finishing-a-development-branch`, nie ręcznym merge'em — także wtedy, gdy właściciel prosi o „zmerguj do mastera” bez wskazania sposobu. Obejmuje to pełny workflow skilla: weryfikację przed scaleniem, integrację **zawsze przez Pull Request** (patrz sekcja „Integracja do `main` — zawsze Pull Request ze squash”) i sprzątnięcie gałęzi oraz worktree. Samo użycie skilla nie uprawnia do scalania PR, push do `main` ani usunięcia niezwiązanej pracy.
- Przed raportem końcowym sprawdź checklistę workflow: zatwierdzenia → plan, jeśli wymagany → skill wykonania → dowody testów → niezależny review i obsługa uwag → końcowa weryfikacja → PR do `main` (zawsze) → scalanie przez właściciela. Każdy pominięty lub dostosowany krok ujawnij z powodem; nie deklaruj pełnego zastosowania skilla, jeśli wykonano tylko część jego instrukcji.

## Poza zakresem MVP

OCR/PDF i nauka z podręczników, chat/awatar AI, rozmowy realtime, OAuth, social/rankingi, marketplace, płatności, rozbudowana gamifikacja, CEFR, natywna aplikacja Android/iOS oraz pełna synchronizacja offline. Zachowuj możliwość rozbudowy przez uzgodnione granice; nie implementuj tych modułów z wyprzedzeniem.
