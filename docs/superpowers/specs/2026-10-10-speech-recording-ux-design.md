# Nagrywanie i zrozumiały wynik odpowiedzi ustnej — projekt

Data: 2026-10-10. Baza analizy: `b7f5f09c2144b1a484e2b58cd713513d0a63da83`.

Status: **do przeglądu właściciela, bez zgody na implementację**. Właściciel zaakceptował kierunek UX i poprosił o przygotowanie planu całego zakresu. Zapisany projekt i plan są dostarczane razem na jego wyraźną prośbę; szczegóły kontraktów wymagają jeszcze zatwierdzenia. Dokument nie zmienia obecnego zachowania aplikacji.

## Cel i zakres

Dziecko ma wiedzieć, kiedy mikrofon rzeczywiście nagrywa, co system rozpoznał i dlaczego próba wymaga poprawy. Ma móc od razu odsłuchać wzorzec lub nagrać kolejną dostępną próbę. Dotyczy odpowiedzi ustnej w `speech` i `recall`, w zwykłym treningu. Nagrywanie przez przytrzymanie jest domyślne; dostępna jest alternatywa przez dwa kliknięcia.

Zakres obejmuje: gest nagrywania, przygotowanie mikrofonu, poziom dźwięku, anulowanie, rezultat STT, rozdzielenie treści i wymowy, oznaczanie fragmentów, odsłuch z feedbacku oraz testy awarii i współbieżności. Nie obejmuje zmiany schedulera, progów wymowy, budżetu sesji, providerów, podziału na sylaby, STT na żywo ani zapisywania/odtwarzania nagrania dziecka.

## Stan obecny i jego ograniczenia

- `SpeechView.tsx` i `WrittenView.tsx`: kliknięcie „Nagraj”, tekst „Nagrywam…”, osobne „Gotowe”; brak poziomu dźwięku. W widoku speech odsłuch może być aktywny podczas nagrywania.
- `LearnScreen.tsx`: feedback ustny we wspólnym modalu, główna ocena nad mniejszym `heardText`; modal ma tylko przycisk kontynuacji.
- `speech.ts`: rozpoznanie niepewne nie tworzy pomyłki. `no_speech` i `failed` są sprowadzane do przyczyny technicznej. Wiarygodny tekst jest ograniczany do 200 znaków; zachowujemy istniejącą bramkę STT.
- `feedback.ts`: niepewność i awaria mają `not_assessed`; zgodna treść z pasmem `below`, brakiem konfiguracji albo awarią wymowy może mieć wspólny `content_matched`.
- `pronunciation-fragments.ts`: heurystyczne mapowanie fonemów na grupy liter; brak score'u bywa oznaczany jako `good`, a fallback potrafi zabarwić całe słowo bez danych lokalizujących problem.
- `browser.ts`: limit 15 sekund; kontroler nie otrzymuje jawnego zdarzenia limitu. Asynchroniczny start wymaga ochrony przed puszczeniem przycisku, zmianą widoku i spóźnionym strumieniem.
- `events.ts`: `authorizeDisclosure` odrzuca zadania terminalne. Przycisk odsłuchu w feedbacku wymaga odrębnej, ograniczonej autoryzacji, a nie obejścia tej reguły.

## 1. Nagrywanie

### Przebieg podstawowy

1. Jeżeli mikrofon nie był przygotowany w tym życiu kontrolera, pokazać „Włącz mikrofon”. Akcja wywołuje systemowe uprawnienie, nie nagrywa odpowiedzi i natychmiast zwalnia uzyskane tracki. Nie przechowywać trwałej informacji o przyznanym uprawnieniu jako gwarancji dostępności urządzenia.
2. Po przygotowaniu: duży przycisk „Przytrzymaj i powiedz”. Początek gestu rozpoczyna uzyskiwanie strumienia. „Słucham — mów teraz” pojawia się dopiero po faktycznym rozpoczęciu nagrywania.
3. Puszczenie po rozpoczęciu kończy nagranie i raz wysyła odpowiedź. W trakcie wysyłania i analizy: „Sprawdzam nagranie…”, bez możliwości kolejnego startu.
4. Puszczenie przed ukończeniem startu unieważnia zamiar: spóźnione tracki są zatrzymane, brak nagrania i próby serwerowej. Pokazać neutralną wskazówkę „Przytrzymaj, aż zobaczysz «Słucham»”.
5. Puszczenie przed 300 ms faktycznego nagrywania porzuca lokalnie audio: „Przytrzymaj przycisk i powiedz całe słowo”. Granica jest filtrem przypadkowego dotknięcia, nie oceną wiedzy ani detekcją ciszy. Od 300 ms nagranie analizuje serwer.
6. Limit 15 000 ms kończy i wysyła rozpoczęte nagranie raz, z komunikatem „Nagranie zakończone”. Późniejsze puszczenie nie tworzy kolejnej próby.

### Gest, dostępność i przerwania

- Mysz: tylko główny przycisk; dotyk i rysik przez Pointer Events. Jeden `pointerId`, pointer capture; puszczenie poza przyciskiem także kończy. `pointercancel`, nieoczekiwana utrata capture, Escape, ukrycie strony, utrata fokusu okna, koniec sesji, zmiana zadania i unmount anulują, bez wysłania częściowego nagrania. Normalne zwolnienie capture po obsłużonym puszczeniu jest no-op.
- Klawiatura: trzymanie Space/Enter rozpoczyna, keyup kończy; key-repeat nie uruchamia nowych nagrań. Utrata fokusu przycisku anuluje gest klawiaturowy. Nie dublować obsługi przez syntetyczny `click`.
- Jawny przełącznik „Nagrywaj kliknięciem”: pierwsze kliknięcie start, drugie „Zakończ nagranie”. Preferencja urządzenia w `LocalPreferences`, klucz `umiem.recordingMode`, wartości `hold | toggle`, domyślnie `hold`. Zmiana trybu w trakcie nagrywania niedostępna.
- Minimum 48 × 48 px, widoczny fokus, instrukcja dostępna dla czytnika ekranu. Reduced motion wyłącza pulsowanie. Poziom dźwięku nie jest ogłaszany na każdej próbce; ogłaszane są zmiany etapów.
- Odtwarzanie wzorca jest zatrzymywane przed startem; wszystkie odsłuchy są zablokowane podczas przygotowania, startu, nagrywania, kończenia i analizy. Kontroler pilnuje tego niezależnie od disabled w React. Spóźniona autoryzacja odsłuchu nie uruchamia audio po rozpoczęciu nagrywania.
- `BrowserAudioPlayer.stop()` unieważnia również oczekujące `fetch` i `blob`, nie tylko istniejący element Audio: generacja odtwarzania i AbortController. Po każdym await player sprawdza ważność generacji. Stop, start nowego play, start mikrofonu, next/end i unmount nie pozwalają spóźnionemu pobraniu utworzyć odtwarzacza. Anulowany play kończy się neutralnie, bez błędu UI; object URL i oczekująca Promise są domykane także po anulowaniu odtwarzania już rozpoczętego.
- Kontroler ma własną generację odtwarzania, unieważnianą na każdym stop i nowym play. Neutralne rozwiązanie anulowanej Promise nie oznacza zakończonego odsłuchu: po await sprawdzić generację i task/epoch przed opcjonalnym `audio_played`, aby anulowanie przed odtworzeniem nie tworzyło ACK odsłuchu. Zapis ekspozycji przed wydaniem wzorca nadal jest autorytatywny.

### Poziom dźwięku i adapter

`PlatformMedia.prepareMicrophone(): Promise<void>` odpowiada tylko za próbę dostępu i zwolnienie strumienia. `createRecorder(options?: RecorderOptions)` przyjmuje opcjonalne `onLevel(level: number)` oraz `onLimitReached()`; nazwy nie zależą od przeglądarki.

Adapter przeglądarkowy liczy RMS lokalnie przez Web Audio API; przekazuje wyłącznie skończoną liczbę 0–1, maksymalnie 10 razy na sekundę. Dla surowego RMS stosuje `clamp(rms * 4, 0, 1)` jako skalę wizualną. Wskaźnik mówi „mikrofon odbiera dźwięk”, nie „rozpoznałem mowę”. Brak analizatora daje neutralny wskaźnik i nie blokuje nagrywania. Próbki nie są zapisywane ani wysyłane.

Stop/cancel/błąd/limit/unmount zamykają analizator, AudioContext, timery i wszystkie tracki. `onLimitReached` oddaje zakończenie kontrolerowi; dotychczasowy adapter bez callbacka nadal sam kończy przechwytywanie. Jednorazowy recorder musi obsłużyć cancel podczas oczekiwania na `getUserMedia` i po zwrocie spóźnionego strumienia.

## 2. Wynik rozpoznania i wymowy

Rozszerzyć `FeedbackDto` o opcjonalne `speech: SpeechFeedbackDto`. Dotychczasowe `kind`, `heardText`, `correctText` i `fragments` pozostają, aby zachować odczyt starego feedbacku. Nowy klient preferuje jawne pola mowy; stary feedback renderuje dotychczasową ścieżką bez dopowiadania nieznanej przyczyny.

```ts
type SpeechRecognitionStatus = "matched" | "different" | "uncertain" | "no_speech" | "unavailable";
type SpeechPronunciationStatus = "good" | "practice" | "unreliable" | "unavailable" | "not_configured" | "not_applicable";
interface SpeechFeedbackDto {
  recognition: SpeechRecognitionStatus;
  pronunciation: SpeechPronunciationStatus;
  referenceText?: string; // ujawniony wzorzec, nigdy prywatny klucz/zbiór wariantów
}
```

W domenie `Grade.speechFeedback` niesie te same statusy i opcjonalny `referenceText` rzeczywiście dopasowanego wariantu dla `matched`. Wybór feedbacku dodaje kanoniczny ujawniony wzorzec dla `different`. Do zadań tekstowych/wyboru nie dodajemy danych mowy. Eksportować również `PronunciationFragmentDto` jako typ wywnioskowany z jego schematu.

| Sygnał | recognition | pronunciation | Komunikat |
| --- | --- | --- | --- |
| STT `no_speech` lub `ok` z `text: null` albo pustym tekstem po trim | no_speech | not_applicable | „Nie usłyszałem słowa. Spróbuj jeszcze raz.” |
| STT failed/deadline | unavailable | not_applicable | „Nie udało mi się sprawdzić nagrania.” |
| Rozbieżne STT odrzucone przez istniejącą bramkę pewności | uncertain | not_applicable | „Nie jestem pewien, co usłyszałem.” |
| Wiarygodna inna odpowiedź | different | not_applicable | „Usłyszałem: …”; „Ćwiczymy: …” w speech, „To słowo to: …” w recall |
| Zgodna treść i band correct | matched | good | „Usłyszałem: …”; „Świetnie!” |
| Zgodna treść i band partial | matched | practice | „To właściwe słowo. Poćwiczmy wymowę.” |
| Zgodna treść i band below | matched | unreliable | „To właściwe słowo. Nie mam pewnej oceny wymowy.” |
| Zgodna treść i failed/no_speech/null score z oceny wymowy | matched | unavailable | „To właściwe słowo. Nie udało mi się sprawdzić wymowy.” |
| Zgodna treść i poprawny wynik providera bez pasm | matched | not_configured | „To właściwe słowo. Wymowa nie została sprawdzona.” |
| Poprawny zatwierdzony wariant bez oceny dla tego wariantu | matched | not_applicable | „To właściwe słowo. Wymowa nie została sprawdzona.” |

Kolejność decyzji: STT/czysty tekst/bramka pewności → dopasowanie → zgodność `expectedText` z dopasowanym wariantem → status/score wymowy → dostępność pasm → band. Nie wyprowadzać szczegółów błędu z nazw providerów. Nie dodawać pól score, confidence, IPA, progu ani klucza odpowiedzi do Kid DTO.

`heardText` nadal wyłącznie po istniejącej bramce STT, NFC, trim, maksymalnie 200 znaków. `uncertain`, `no_speech`, `unavailable` nie mają `heardText`, `referenceText` ani fragmentów. Rozpoznawanie jest wynikiem systemu, nie zapewnieniem „powiedziałeś dokładnie to”. Niepewna odpowiedź nie tworzy confusion ani błędu wiedzy.

Każdy submit/read/retry feedbacku pieczętuje pełny zestaw ekspozycji **przed HTTP**: dotychczasowy kanoniczny cel, jeżeli był ujawniany, oraz rzeczywiście pokazany `referenceText` (w tym zatwierdzony wariant) i wiarygodny `heardText`. Fragmenty są reprezentacją `referenceText`, nie oddzielnymi celami. Wariant ma własny `computeTargetKey(text, targetLocale)`; rozpoznany tekst przechodzi tę samą normalizację brzegowej interpunkcji co dopasowanie mowy. Dotyczy także celu w innym zestawie. Zestaw kluczy deduplikować; nie dopisywać ekspozycji z ukrytej niepewnej transkrypcji. Nowe ujawnienie nie zmienia kwalifikacji zakończonej próby; wpływa na przyszłe sprawdzenia/scheduler i kolejne podejście. Legacy zachowuje utrwalony payload, ale jego ponowne wydanie również rejestruje faktycznie wyświetlany tekst.

Ogólne `kind` zachowuje dotychczasowe reguły postępu i zamykania zadania. `practice` nie zmienia partial w sukces; `unreliable` nie zmienia below w błąd wiedzy. Poprawny Recall pozostaje poprawny mimo awarii wymowy. Wyłącznie nowy pusty tekst STT uzyskuje nieoceniony wynik zamiast błędnej odpowiedzi. Utrwalony stary feedback i oceny pozostają niezmienne.

## 3. Fragmenty wymowy

- Kolorujemy `referenceText`, nie transkrypcję. Zielony = oceniony fragment „dobrze”; bursztynowy i podkreślenie = „do ćwiczenia”; neutralny = brak pewnych danych. Dodać werdykt `unknown` do typu domenowego i kontraktu fragmentów.
- Nie obiecujemy lokalizacji sylaby. Korzystamy z obecnego mapowania fonem → grupa liter, ale usuwamy dowolne dopasowanie jednej samogłoski do dowolnego fonemu samogłoskowego. Używać tylko rozpoznanych, jednoznacznych kandydatów mapowania; niezgodność lub pozostawione fonemy powodują neutralny fallback.
- Brak lokalnego score'u lub nieskończony score daje temu fragmentowi `unknown`; inne pewnie dopasowane fragmenty mogą zachować swoje oceny. Brak słowa/fonemów, niedopasowany tekst albo niejednoznaczne mapowanie daje neutralny fallback całego oryginalnego `referenceText`, bez twierdzenia o miejscu problemu; ogólna ocena może nadal być dobra/partial.
- `errorType: null`, `None` lub `Mispronunciation` dopuszczają mapowanie po przejściu pozostałych bramek. `Omission`, `Insertion` oraz pozostałe nieobsługiwane/nieznane typy dają neutralny fallback. `Mispronunciation` samo oznacza trudność, nie brak użytecznych danych fonemów; nie wycinać oznaczeń partial tylko z tego powodu. [Definicje wyników Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment#result-parameters).
- Zachować oryginalny tekst, wielkość liter i znaki. Jeżeli bez utraty znaków nie potrafimy odtworzyć mapowania (np. apostrof, łącznik), wyświetlić neutralny cały tekst. Maksymalnie 6 fragmentów: scalać sąsiednie o tym samym werdykcie; jeśli nadal więcej, cały tekst neutralny.
- Fragmenty dla `good | practice`, tylko wobec dokładnie ocenionego dopasowanego wariantu. `unreliable`, `unavailable`, `not_configured`, `not_applicable` bez lokalnych fragmentów.
- Legenda tekstowa i dostępny opis fragmentów; żadnych score'ów lub IPA. „Poćwicz zaznaczony fragment” tylko gdy jest rzeczywisty fragment `almost`. Bez lokalizacji: „Posłuchaj wzorca i spróbuj ponownie”, jeśli zadanie nadal dopuszcza próbę.

## 4. Karta wyniku i działania

Nowy `SpeechFeedbackCard` w przepływie pod zadaniem, bez modalu, tylko dla feedbacku z mowy. Pozostałe feedbacki zachowują istniejące widoki. Kolejność: duże „Usłyszałem: …” (jeśli dostępne), wyjaśnienie, wzorcowe słowo z fragmentami/legendą, działania. Przy braku transkrypcji na górze wyjaśnienie braku rozpoznania. Karta przewijana do widoku; fokus na tytule (`tabIndex=-1`), bez uruchamiania przypadkowego nagrania i bez pułapki fokusu.

`feedback.dto: null` otrzymuje ogólny neutralny komunikat „Nie udało się ocenić. Spróbuj jeszcze raz”, bez transkrypcji/wzorca/fragmentów i bez przypisywania nieznanej przyczyny. Rodzaj próby identyfikuje `modality`, nie obecność nowego pola `speech`.

- `retry=true`: główne „Nagraj jeszcze raz” usuwa feedback i wraca do gotowego przycisku; samo kliknięcie tej akcji nie rozpoczyna nagrywania. „Pomiń” zamyka zadanie bez błędu wiedzy, aby dziecko nie utknęło po awarii.
- `retry=false`: „Dalej”. Nie oferować dodatkowej ocenianej próby po zamknięciu zadania. Zgodna treść może zakończyć speech mimo częściowej/niepewnej oceny wymowy; obecna domena decyduje o tym, nie UI.
- „Posłuchaj wzorca” na tej samej karcie, gdy istnieje ujawniony `referenceText` i gotowe audio kanonicznego wzorca. Przy zaakceptowanym innym wariancie bez gotowego audio odpowiadającego `referenceText` nie pokazywać przycisku; nie podszywać kanonicznego audio pod wariant.
- Treść i wynik `practice` bursztynowe; problemy rozpoznania/oceny neutralne. Poprawny Recall z nieocenioną wymową ma pochwałę treści oraz osobną neutralną informację o wymowie.
- Błąd odsłuchu nie zastępuje oceny i nie tworzy kolejnej próby; komunikat „Nie udało się odtworzyć wzorca”. Utrata sieci nadal blokuje operacje i nie pokazuje fałszywego sukcesu.

### Autoryzacja odsłuchu w feedbacku

Nowy endpoint `POST /api/v1/kid/attempts/:attemptId/feedback-audio`, bez body, wywołuje `authorizeFeedbackAudio(services, attemptId): Promise<FeedbackAudioDto>` w nowym module `feedback-audio.ts`.

`FeedbackAudioDto = { attemptId, taskId, stepId, audioAssetId }`; `FeedbackDto.referenceAudioAvailable?: boolean` to wskazówka widoczności przycisku ustalana dla nowego feedbacku z mowy podczas finalizacji. Endpoint zawsze ponownie waliduje stan, niezależnie od wskazówki. Stary feedback bez pola nie pokazuje przycisku; nie przepisujemy go.

Pod wspólną blokadą sesji endpoint wymaga: zwykłego treningu, aktywnej sesji, zakończonej próby audio z utrwalonym feedbackiem ujawniającym wzorzec, najnowszej próby tego zadania, braku później wydanego zadania, dokładnej zgodności `referenceText` z kanonicznym wzorcem i gotowego zasobu TTS z przypiętej rewizji. Obsługuje zadanie `issued` lub terminalne, ale nie starą kartę po przejściu dalej. Nie pozwala odtwarzać wzorca dla niepewnej/cichej/technicznej transkrypcji, dla obcego celu ani w `mock_test`.

Zapisuje zamknięte `audio_issued` z właściwym targetKey przed zwróceniem zasobu, także przy każdym replay z cache. Wykorzystuje tę samą logikę reservations/settledChecks co ujawnienie audio w `events.ts`; nie przepisuje wcześniejszej oceny ani zamrożonego kontekstu. W recall odsłuch wpływa na samodzielność kolejnego podejścia zgodnie z obecną regułą 300 sekund. Wyścigi z next/end/drugą przeglądarką są serializowane; klient ponownie sprawdza identyfikator karty po await przed odtworzeniem.

## 5. Prywatność, kompatybilność i dowody

- Brak zmian tabel i migracji: nowe pola feedbacku w istniejącym JSONB. Przejrzeć autorytatywny Drizzle i triggery; nie rozwijać osobnej definicji SQL. Historia zakończonych prób nie jest przepisywana.
- Nie zapisywać audio w bazie, kolejce, plikach, logach, test fixture, trace ani backupie. Nie logować transkrypcji. Transkrypcje nadal podlegają istniejącemu usuwaniu profilu. Lokalne ustawienia przechowują tylko tryb obsługi mikrofonu.
- UI `pl-PL`, treść/wymowa `en-GB`, komunikaty w `packages/contracts/src/messages.ts`. Kid UI korzysta z jawnego API/baseUrl i portów platformowych, bez importów Next.js, DB lub provider SDK.
- Brak nowych zależności produktu; RMS przez Web Audio API. Testy automatyczne używają fake-providerów i syntetycznych danych; nie wysyłać głosu dziecka do usługi jako diagnostyki bez osobnej zgody.
- Automaty: kontrakty, kontrolowany zegar/timery, fake strumienie, docelowy PostgreSQL, Playwright z dotykiem/klawiaturą i viewportami 390×844 oraz 768×1024. Testy przepływu audio mają `trace: "off"`, bez HAR/video ani zapisu payloadów; dotyczy również istniejących testów nagrywania uruchamianych w tym zakresie. Syntetyczne strumienie tworzyć w pamięci, bez fixture audio.
- Regresje z bazowego planu: R01 (ujawnienia/ACK/reload/dwóch klientów), R03 (niezmienna historia i CASCADE profilu), R05 (ochrona należnych samodzielnych sprawdzeń po ujawnieniu), R07 (zatwierdzone warianty i adekwatna ocena wymowy). R04 jako kontrola niezmienionego przejścia exposure. R02/R06 dotyczą przygotowania niezmiennych mediów i nie mają nowych zmian w tym zakresie; istniejące pełne suite są regresją. Mikrofon, limit i budżet sprawdzamy dodatkowo, bez błędnego przypisywania im numerów R02/R06/R07.
- Rzeczywisty telefon/tablet: osobno sprawdzić zgodę, opóźnienie startu, przytrzymanie, wskaźnik, zwolnienie mikrofonu, przerwanie i czytelność wyniku. Bez urządzenia jawnie raportować brak tego dowodu. Jakość mapowania na głosie dziecka wymaga osobnej autoryzowanej próby, nie jest potwierdzana fake-testami.

## Kryteria odbioru

1. Jedno przytrzymanie i puszczenie = co najwyżej jedna próba; puszczenie przed startem/anulowanie = zero prób i zwolnione tracki.
2. Brak nagrania przed zgodą; koniec limitu, tło i błędy nie zostawiają aktywnego mikrofonu.
3. Dziecko widzi wiarygodny tekst i osobny wynik wymowy albo zrozumiałą przyczynę jego braku.
4. Brak lokalnych danych nigdy nie daje zielonego fragmentu, a inny wariant nie dziedziczy oceny kanonicznego tekstu.
5. Odsłuch dostępny na karcie tylko przy rzeczywistej dostępności; każde ujawnienie zapisane przed odpowiedzią, również po terminalnej odpowiedzi i z cache.
6. Alternatywa kliknięciem, klawiatura i ścieżka bez mikrofonu działają; brak nieskończonych prób i powiększania obiecanego budżetu.
7. Testy, review całego zakresu i ograniczenia rzeczywistego urządzenia udokumentowane przed PR implementacyjnym.
