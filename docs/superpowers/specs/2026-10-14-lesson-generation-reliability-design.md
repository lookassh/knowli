# Niezawodne generowanie lekcji — projekt naprawy

Status: projekt i plan zaakceptowane przez właściciela 2026-10-14. Zgoda obejmuje naprawy i testy określone w planie; nie obejmuje integracji poza PR ani wdrożenia.

Stan sprawdzony: `c734fbebe716849464eb1939500ae499dcac8f38`, worktree `de40/knowli`, gałąź `feature/grammar-without-tts`. Audyt bazował na `e079c6c`; późniejszy zakres TTS nie naprawia opisanych tu problemów. Źródło reprodukcji: [głębokie review](../reviews/2026-10-14-lesson-generation-deep-review.md).

## Cel i zakres

Rodzic ma otrzymać poprawny szkic Present Simple bez odrzucania naturalnych odpowiedzi operatorowych, ujawniania rozwiązania w tłumaczeniu, utraty treści po zapisie starego formularza ani nieograniczonego oczekiwania na LLM. Usuwamy bezcelowe ponowienia błędów trwałych. Przygotowanie gramatyki pozostaje bez TTS.

Zakres: deduplikacja, semantyka bodźca tłumaczenia i podpowiedzi luki, schemat wyjścia ograniczony do celu, odporność na `null`, optimistic locking, timeout/anulowanie, klasyfikacja ponowień oraz test przepływu i pomiar czasu. Spójna obsługa równoległych top-upów jest niezbędną częścią ochrony zapisu.

Poza zakresem: zmiana modelu/providerów, nowy broker, streaming, generacja podczas sesji, automatyczne publikowanie, przepisanie historii prób, ponowne włączenie TTS, nowy system oceny postępu. Checkpointy każdej partii i odzyskiwanie pełnego runu po restarcie pozostają osobnym rozszerzeniem: ten plan nie obiecuje zachowania w bazie wyniku wcześniejszej partii, jeśli późniejsza partia kończy cały run błędem.

## Rozważone podejścia

1. **Zalecane: poprawić obecny potok.** Zachować moduły przedmiotów, walidację domenową i zatwierdzanie rodzica, doprecyzować wejście modelu i kontrolować wykonanie. Obejmuje wszystkie zgłoszone grupy błędów i zachowuje historię.
2. Zmniejszyć pulę, rozluźnić walidację lub obniżyć minimum publikacji. Może skrócić odpowiedź modelu, ale nie usuwa utraty danych ani wycieku odpowiedzi; odrzucone.
3. Przebudować generację na trwałe zadania per cel z checkpointami. Ułatwi odzyskiwanie i częściowe ponowienia, ale zwiększa zakres modelu danych i cyklu zleceń. Do rozważenia po pomiarach obecnego potoku, poza tym planem.

## D1. Unikalność ćwiczenia i historia ujawnienia to osobne reguły

- Gramatyka wybiera `SubjectModule.poolDeduplication = "exercise"`; nieustawiona opcja zachowuje obecną deduplikację odpowiedzi innych przedmiotów.
- Tożsamość ćwiczenia tworzą cel, typ i funkcjonalny bodziec: `stem`, `statement` wraz z `transformId`, `prompt`, uporządkowane `noticeSegments` albo zestaw tekstów klocków. Nie tworzymy innego ćwiczenia przez zmianę ID opcji, kolejności prezentacji, samej podpowiedzi czy kosmetycznego polecenia. Normalizacja bodźca: NFC, trim, redukcja białych znaków, lowercase; znaczące znaki, w tym `___`, zostają.
- Różne zdania z odpowiedzią `do`, `does`, `don't` lub `doesn't` są poprawną różnorodnością. Ten sam bodziec tego samego typu i celu jest duplikatem także przy innej odpowiedzi; konfliktujące klucze nie tworzą nowego zadania.
- Prompt zabrania powtarzać ćwiczenie, zamiast zabraniać wykorzystania potrzebnej odpowiedzi. Przekazuje ograniczone opisy istniejących bodźców, bez danych dzieci i technicznych identyfikatorów. Dla dawnych zleceń zawierających `existingAnswers` worker odbudowuje opisy ćwiczeń z bieżącego szkicu.
- `target_key`, normalizacja odpowiedzi, zapis ekspozycji, kwalifikacja próby i rezerwacje samodzielnych sprawdzeń zachowują obecną semantykę. Wcześniej ujawnione `does` nadal nie staje się samodzielnym sukcesem przez zmianę zdania. Minimum publikacji pozostaje **3 prowadzone / 4 produktywne / 2 tłumaczenia na cel**. Liczność puli nie jest obietnicą liczby nieujawnionych odpowiedzi.
- Gdy cały materiał dla danego celu został ujawniony, pozostaje nauka ze wsparciem i istniejące odroczenie sprawdzenia. Zmiana definicji samodzielności lub klucza ekspozycji wymaga osobnego projektu; nie ukrywamy tego problemu przez usunięcie kontroli ekspozycji.

## D2. Tłumaczenie i luka mają jednoznaczną semantykę

- `english_grammar` określa przez istniejący profil `fieldRules`, że `lesson_open_answer.prompt` jest zdaniem w języku polecenia (`pl-PL`) do przetłumaczenia, a `answer` i warianty są w `en-GB`. Adapter usuwa sprzeczną regułę nakazującą język odpowiedzi każdemu bodźcowi i respektuje profil przedmiotu.
- Przykład: polecenie „Przetłumacz na angielski.”, bodziec „Ona codziennie gra w piłkę.”, odpowiedź `She plays football every day.`. Angielska odpowiedź nie występuje w Kid DTO przed oceną.
- Walidator gramatyki odrzuca bodziec tłumaczenia równy odpowiedzi kanonicznej lub zatwierdzonemu wariantowi po normalizacji. Jest to deterministyczna ochrona przed odtworzonym wyciekiem, nie ogólny detektor języka. Język bodźca kontrolują prompt, przykłady, regresje i przegląd rodzica; nie dodajemy LLM do walidacji.
- Luka może wymagać czasownika głównego, operatora albo operatora z czasownikiem. Walidator przedmiotu uwzględnia cel oraz tekst po podstawieniu luki, a nie samą odpowiedź wyrwaną ze zdania. Nie powstaje ogólny parser gramatyki.
- `She ___ play tennis.` + `does not`/`doesn't` + `hint=do` przechodzi. `She ___ plays tennis.` + `does not` odpada. `She ___ tennis.` + `plays` + `hint=play` i `She ___ tennis.` + `doesn't play` + `hint=play` przechodzą. Krótka odpowiedź `Yes, he ___.` + `does` nie wymaga czasownika głównego. Podpowiedź ma odpowiadać roli luki; polskie objaśnienie nie jest bezokolicznikiem.
- Publikacja i edycja nowego szkicu korzystają z tego samego walidatora. Nie zmieniamy już opublikowanych rewizji ani istniejących zadań.

## D3. Schemat i walidacja opisują tę samą partię

- Generator ogranicza typy do przecięcia typów przedmiotu i celu, bez `lesson_card`. Schemat ogranicza `objectiveId` do celów żądania; dotyczy to także przykładów i `transformId`.
- Bieżący worker wysyła jeden cel na partię. Jeśli adapter obsłuży więcej celów, zależność cel → typ należy wyrazić gałęziami `anyOf` wewnątrz `exercises.items`; brak dozwolonych typów jest błędem lokalnym przed HTTP.
- Zachowujemy object na korzeniu, wszystkie pola w `required`, `additionalProperties=false`, nullable tylko dla pól rzeczywiście opcjonalnych. Nie dodajemy nieobsługiwanych konstrukcji `if/then/else`. Walidacja semantyczna po odpowiedzi pozostaje obowiązkowa.
- Każdy element surowej tablicy jest sprawdzany przed pierwszym odczytem `.answer` albo tablic potomnych. `[poprawne ćwiczenie, null]` zapisuje poprawne ćwiczenie i zwiększa `rejectedCount` o 1. Pusty wynik lub brak poprawnych ćwiczeń kończy się `failed/validation`, bez ślepego ponowienia.

To zasady zgodne z aktualnie sprawdzoną [dokumentacją Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat). Zgodność alternatywnego endpointu nadal wymaga jego własnego testu; dokumentacja OpenAI jej nie dowodzi.

## D4. Worker jest pełnoprawnym edytorem szkicu

- Każdy zapis zmieniający ćwiczenia, przykłady lub kontekst przez worker atomowo zwiększa `deck_versions.edit_number` o 1, razem z treścią, uzgodnieniem mediów i zakończeniem runu. Idempotentne powtórzenie zakończonego runu nie zwiększa numeru.
- Kolejność blokad: wersja szkicu → run. Tuż przed zapisem sprawdzamy stan runu, numer próby, `expectedEditNumber`, stan wersji i bieżącą tożsamość ćwiczeń.
- Jeden aktywny run `lesson` (`queued`/`running`) na szkic. `regenerateObjective` rezerwuje go pod blokadą wersji; drugi różny request dostaje istniejące `409 conflict`. Powtórzony `clientRequestId` zwraca ten sam run. UI blokuje dogenerowanie podczas aktywnej generacji, lecz serwer zapewnia regułę niezależnie od UI.
- Zapis rodzica nadal może wygrać z workerem: zwiększa editNumber i oznacza starsze aktywne runy `superseded` w tej samej transakcji. Worker wtedy przerywa pracę i nie zapisuje wyniku. Jeżeli wygra worker, PATCH starego formularza daje `409`, zachowuje lokalny formularz i proponuje załadowanie aktualnej wersji.
- Dawne równoległe top-upy nie są automatycznie przenoszone na nową edycję. Po pierwszym zaakceptowanym zapisie pozostałe starsze runy są `superseded`; rodzic może zlecić nowy top-up aktualnego szkicu. Finalizacja nigdy nie ufa samej migawce z enqueue.

## D5. Błędy i ponowienia

Adapter przekazuje typowany, pozbawiony sekretów błąd przez port. Stan runu i liczba prób pozostają w istniejącym DTO; nowe przyczyny trafiają do otwartego pola `errorCode` i polskich komunikatów rodzica.

| Warunek | Stan i dalsza praca |
| --- | --- |
| HTTP 400/401/403/404/422, nieobsługiwany schemat/model | `failed/provider_configuration`; 1 request, bez identycznego retry |
| `refusal` / `content_filter` | `failed/provider_refusal`; bez automatycznego retry |
| `finish_reason=length`, nawet przy parsowalnym JSON | `failed/provider_incomplete`; bez przyjmowania niekompletnego wyniku i powtarzania tej samej partii |
| Niepoprawny JSON lub koperta HTTP 200 | `failed/provider_output`; bez fallbacku usuwającego markdown i bez ślepego retry |
| Pojedynczy wadliwy element | Odrzucenie elementu; poprawne ćwiczenia zostają |
| HTTP 429 z kodem quota/spend/usage limit | `failed/provider_configuration`; bez automatycznego retry |
| HTTP 429 rate limit, 408, 5xx; przejściowy transport | Maksymalnie 3 automatyczne próby, z trwałym odroczeniem |
| Timeout wywołania / runu | `failed/provider_timeout`; ręczne ponowienie po informacji o możliwym naliczeniu przez usługę |
| Retry rodzica, edycja szkicu, shutdown | Przerwanie starego wykonania; brak jego kolejnej partii i zapisu |

Odroczenie: nowa nullable kolumna `generation_runs.next_attempt_at` (`timestamptz`), bez zmiany stanów DTO. Pierwsze i drugie ponowienie po 1 s i 2 s + jitter 0–20%; poprawne `Retry-After` ustala dolną granicę (sekundy lub data HTTP). Oczekiwanie odbywa się w kolejce, nie przez sleep trzymający slot. Pole zerujemy przy ręcznym retry i stanie terminalnym. Dla dotychczasowych runów wartość null oznacza brak odroczenia. Migracja addytywna, z testem aktualizacji istniejącej bazy.

Rozróżnienie przyczyn HTTP i odroczenie opierają się na [dokumentacji błędów OpenAI](https://developers.openai.com/api/docs/guides/error-codes); klasyfikację kodów alternatywnego endpointu testujemy jego adapterem, bez logowania treści błędu dostawcy.

## D6. Czas wykonania i anulowanie

- Konfigurowalne wartości startowe: `UMIEM_LESSON_REQUEST_TIMEOUT_MS=90000`, `UMIEM_LESSON_RUN_TIMEOUT_MS=600000`, `UMIEM_LESSON_CANCEL_POLL_MS=1000`. Run timeout dotyczy jednego wykonania po claimie, nie czasu w kolejce ani sumy automatycznych prób. Wartości dodatnie, request timeout ≤ run timeout. To propozycje do strojenia po pomiarze, nie zmierzone SLA produkcyjne.
- Wszystkie wywołania `generateLessonPool` otrzymują złożony AbortSignal: deadline partii, runu, aktualność runu i shutdown. Adapter stosuje własny deadline także przy bezpośrednim wywołaniu, obejmujący fetch i czytanie body.
- Worker sprawdza aktualność przed i po każdej partii oraz co 1 s podczas oczekiwania. Porównuje run state/attempts/expectedEditNumber i edycję szkicu. Dzięki temu retry z procesu web przerywa HTTP w innym procesie worker; nie polegamy wyłącznie na mapie kontrolerów w pamięci.
- Guard kończy lokalne oczekiwanie również wtedy, gdy fake lub alternatywny provider ignoruje AbortSignal. Spóźniony wynik jest obsłużony bez unhandled rejection, nie uruchamia kolejnej partii ani nie zapisuje treści. Nie można zagwarantować cofnięcia przetwarzania lub naliczenia po stronie zewnętrznej usługi.
- Timery/listenery są zwalniane w `finally`. HTTP nie odbywa się w transakcji ani pod blokadą wersji.
- Przy shutdown aktualny run wraca do queued bez resetu attempts: nowy claim ma nowy numer wykonania, a już wykorzystana próba nadal liczy się do budżetu. Ręczny retry resetuje budżet dopiero razem ze zwiększeniem edycji; nie wolno ponownie użyć pełnej tożsamości starego wykonania.

## D7. Worker i pomiar

- Pętla procesu nie dokleja kolejnych Promise co 2 s podczas długiego przelotu: kolejny polling planuje po zakończeniu bieżącego. Shutdown przekazuje sygnał do bieżącego wykonania.
- W obrębie jednego procesu najwyżej 2 aktywne zadania i 1 obraz. Dobór obejmuje rodzaje pracy sprawiedliwie; jeden czekający LLM nie zajmuje obu slotów i nie blokuje gotowego TTS słówek. Partie jednego runu pozostają sekwencyjne. Ten limit nie jest globalnym limitem wielu replik workera.
- Logi zawierają: rodzaj pracy, run, cel, numer próby, model, czas partii/runu, liczbę przyjętych/odrzuconych, bezpieczny kod błędu i odroczenie. Bez materiału rodzica, surowych odpowiedzi, danych dzieci, tokenów oraz body błędu HTTP. Dotychczasowy log pełnej wiadomości błędu dostawcy należy usunąć.
- Health workera uwzględnia wiek ostatniego rozpoczęcia/zakończenia przelotu, a nie tylko istnienie procesu. `WORKER_HEALTH_STALE_MS=900000` jest osobnym dodatnim parametrem; w czasie oczekiwanej długiej pracy pomiar odnosi się do początku bieżącego przelotu. Po przekroczeniu progu `/health` zwraca 503; zdrowy idle/working zwraca 200. Nie deklarujemy zdrowia zatrzymanej pętli ani konfiguracji progu jako dowodu anulowania HTTP.

## Kryteria akceptacji

| ID | Dowód wymagany przed ukończeniem |
| --- | --- |
| A1 | Osiem odtworzonych luk różnych celów przechodzi; dokładne duplikaty bodźca odpadają; short_answers ma 4 produktywne ćwiczenia |
| A2 | Powtórzona odpowiedź po ujawnieniu nadal nie daje samodzielnego sukcesu; historia, istniejące target_key i snapshoty nie są przepisywane |
| A3 | Generacja → publikacja → Kid DTO daje polski bodziec tłumaczenia; prompt równy rozwiązaniu jest odrzucony |
| A4 | Luki operatorowe z does not/doesn't i hint=do są poprawne; plays po does not nadal jest odrzucone |
| A5 | Schemat celu nie dopuszcza obcego objectiveId/typu; null odrzuca tylko jeden element; brak poprawnych elementów kończy run |
| A6 | Worker zwiększa editNumber atomowo; stary PATCH daje 409 bez usunięcia nowych zadań; dwa klienty zachowują własne formularze |
| A7 | Dwa różne top-upy nie działają równocześnie na tym samym szkicu; duplikat requestu pozostaje idempotentny; dawne runy nie dopisują duplikatów |
| A8 | HTTP 400 wykonuje jeden request; 429/5xx respektują odroczenie i limit 3; timeout nie jest automatycznie ponawiany |
| A9 | Timeout ogranicza oczekiwanie; retry/edycja/shutdown przerywa starą partię, nie wykonuje następnej i nie pozwala na późny zapis |
| A10 | Inne zadanie i media słówek postępują przy jednym oczekującym LLM; polling nie nakłada się; health wykrywa zatrzymany przelot |
| A11 | Pełne wymagane suite, typecheck i build oraz niezależne review całego zakresu; 0 Critical/Important przed PR |
| A12 | Zapis pomiaru przed/po na identycznym syntetycznym materiale; wynik fake oznaczony jako fake, brak obietnicy skrócenia czasu żywego modelu bez benchmarku |

## API → MCP → skill i wdrożenie

DTO i `schemaVersion` pozostają bez nowych pól. Zmienia się semantyka editNumber (obejmuje każdy zapis workera), odmowa drugiego aktywnego top-upu przez istniejące 409 oraz przyczyny `errorCode`. Należy przetestować HTTP i polski UI oraz opisać zmiany w dokumentacji API.

`learning-overview` świadomie wyklucza lekcje; MCP/skill Hermesa nie udostępniają generacji ani edycji lekcji. Przy potwierdzeniu tego zakresu w implementacji nie zmieniają się adapter, przenośny schemat ani skill. Testy HTTP MCP, schema export i filtr lekcji mają pozostać zielone; uzasadnienie w dzienniku i PR. W razie ujawnienia szerszego wpływu trzeba zaktualizować kontrakt i integrację w tym samym zakresie, zamiast utrwalać założenie.

Osobna gałąź `feature/lesson-generation-reliability` przy wykonaniu; nie dopisywać implementacji do PR #58. Zweryfikować świeże main i obecność wyłączenia TTS. Jeśli #58 jeszcze nie scalono, zapisać zależność i uzgodnioną bazę bez samodzielnego scalania. Przed uruchomieniem nowego workera zastosować migrację next_attempt_at; następnie wdrożyć web+worker. Brak automatycznej regeneracji lub zmiany opublikowanych lekcji. Stary szkic rodzic może poprawić lub dogenerować; wcześniej opublikowane wadliwe bodźce wymagają nowego szkicu i zatwierdzenia rodzica.

## Przegląd dokumentu

- [x] Sześć grup z polecenia ma rozwiązanie i kryterium akceptacji.
- [x] Powtarzalne odpowiedzi nie zmieniają semantyki samodzielności.
- [x] Dokładne koszty, SLA i zgodność alternatywnego LLM nie są przedstawione jako zmierzone.
- [x] Utrwalone są proponowane ustawienia, zmiana danych i wpływ na współbieżność.
- [ ] Przegląd i zatwierdzenie projektu przez właściciela przed implementacją.
