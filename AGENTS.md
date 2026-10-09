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

- Przed rozpoczęciem zadania sprawdź dostępne skillsy Superpowers i użyj tych, które pasują do pracy; stosuj ich workflow. Przykładowo: brainstorming przed projektowaniem funkcji, writing-plans przed wieloetapową implementacją, systematic-debugging przy błędach, test-driven-development przy poprawkach, verification-before-completion przed uznaniem pracy za zakończoną oraz finishing-a-development-branch przy scalaniu gałęzi roboczej. Polecenia właściciela i instrukcje tego pliku mają pierwszeństwo.
- Realizuj uzgodniony plan małymi zadaniami z działającym, sprawdzalnym rezultatem. Nie traktuj odczytania tego pliku jako polecenia zbudowania całego MVP.
- Próbę mowy i mediów wykonaj zgodnie z zadaniem 0. Bez kluczy lub docelowego urządzenia opisz brakujące dowody; tekstowy fundament może powstawać dalej. Nie deklaruj gotowej oceny wymowy bez tej próby.
- Nie dodawaj funkcji poza aktualnym zadaniem. Deleguj pracę innym agentom tylko po wyraźnej zgodzie użytkownika.
- Dla reguł oceny, historii, współbieżności i danych dodawaj znaczące testy. Testy domeny używają kontrolowanego zegara, integracyjne docelowego PostgreSQL, a providerów w testach zastępują fake-adaptery.
- Pokryj odpowiednie regresje R01–R07 z planu; weryfikuj awarie, retry, dwie przeglądarki i usuwanie profilu, nie tylko poprawny przebieg.
- Uruchamiaj istniejące skrypty adekwatne do zmiany. Planowane komendy: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`. Najpierw sprawdź `package.json`; nie twierdź, że skrypty już istnieją.
- Początkowy SQL jest projektem do odwzorowania. Po wdrożeniu Drizzle utrzymuj autorytatywny schemat TypeScript i przeglądane migracje SQL, w tym wymagane triggery; nie rozwijaj niezależnie dwóch definicji.
- Aktualizuj dokumentację, gdy zmienia się uzgodniony kontrakt lub decyzja. Raportuj co zmieniono, co rzeczywiście sprawdzono i co pozostaje niezweryfikowane. Sprawdzenia SQL w PGlite nie są testami gotowej aplikacji.

### Obowiązkowe wykonanie workflow Superpowers

- Przeczytanie lub wymienienie skilla nie oznacza wykonania jego workflow. Przed implementacją utwórz i aktualizuj checklistę wymaganych kroków, artefaktów oraz zatwierdzeń.
- Klasyfikuj zadanie według całego zakresu zmian. Zmiana publicznego DTO/API, modelu danych lub współpracy klient–serwer wymaga ścieżki architectural. Nie traktuj jej jako bounded tylko dlatego, że widoczny efekt dotyczy jednego ekranu.
- Dla wieloetapowej implementacji użyj writing-plans, a następnie executing-plans. Zachowaj wymagane przez brainstorming etapy zatwierdzania. Delegacja nadal wymaga wyraźnej zgody właściciela.
- Gdy pracujesz w worktree (lub na gałęzi roboczej), scalanie zmian do głównej gałęzi (`main`) wykonuj skillem finishing-a-development-branch, nie ręcznym merge'em — także wtedy, gdy właściciel prosi o „zmerguj do mastera" bez wskazania sposobu. Obejmuje to pełny workflow skilla: weryfikację przed scaleniem, integrację i sprzątnięcie gałęzi oraz worktree.
- Przy TDD uruchom test nowego zachowania przed napisaniem odpowiadającego mu kodu i potwierdź oczekiwaną porażkę. Późniejsze przejście testów nie zastępuje dowodu RED.
- Przed raportem końcowym sprawdź checklistę workflow. Każdy pominięty krok ujawnij z powodem; nie deklaruj pełnego zastosowania skilla, jeśli wykonano tylko część jego instrukcji.

## Poza zakresem MVP

OCR/PDF i nauka z podręczników, chat/awatar AI, rozmowy realtime, OAuth, social/rankingi, marketplace, płatności, rozbudowana gamifikacja, CEFR, natywna aplikacja Android/iOS oraz pełna synchronizacja offline. Zachowuj możliwość rozbudowy przez uzgodnione granice; nie implementuj tych modułów z wyprzedzeniem.
