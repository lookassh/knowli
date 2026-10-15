# Zestawy obrazkowe i nauka bez czytania — projekt

Data: 2026-10-14. Podstawa: projekt i rodzaje zadań uzgodnione z właścicielem w rozmowie. Status: zapisany projekt do przeglądu; zapis nie oznacza rozpoczęcia implementacji ani zatwierdzenia wykonania.

## 1. Cel

Rodzic oznacza, że dziecko jeszcze nie czyta, oraz generuje zestaw obrazkowy. Generator dobiera materiał możliwy do jednoznacznego przedstawienia bez napisów. Rodzic sprawdza gotowe ilustracje i publikuje cały zestaw. Dziecko uczy się przez obrazki, słuchanie i mówienie. Dzieci czytające mogą korzystać z tego samego materiału i dodatkowo ćwiczyć czytanie oraz pisownię.

Nie dzielimy standardowego zestawu na automatycznie wybraną część dla dziecka nieczytającego. Nie dodajemy osobnego potwierdzenia każdej karty. Zestaw obrazkowy jest wariantem modułu vocabulary, a nie nowym przedmiotem: `decks.kind = vocabulary`, te same przypisania, historia, skill_versions i reguły oceny.

## 2. Ograniczenia globalne

- Interfejs i dokumentacja po polsku; UI `pl-PL`, materiał początkowo `pl-PL` → `en-GB`.
- Kid UI pozostaje przenośny: jawne Kid API, konfigurowalny baseUrl i istniejące adaptery mediów; bez importów Next.js lub serwera.
- Opublikowana treść, wydany prompt, klucz odpowiedzi i zakończona ocena pozostają niezmienne.
- Historia i projekcja umiejętności pozostają wspólne; sama zmiana sposobu prezentacji nie resetuje postępu.
- Nie zmieniamy reguły 300 sekund, progów wymowy ani zasad potwierdzania samodzielności.
- Nagrania dzieci pozostają krótkotrwale w pamięci, bez trwałego zapisu i bez logowania.
- Nie dodajemy offline, Androida, nowych mikroserwisów ani wywołań LLM/TTS przy kliknięciu dziecka.

## 3. Profil i wariant materiału

### 3.1. Profil

`canRead: boolean` trafia do ChildInput, ChildPatch, ChildDto, KidProfileDto i `child_profiles.can_read`. Nowe i istniejące profile domyślnie mają `true`. Checkbox rodzica „Dziecko jeszcze nie czyta” zapisuje `false`. Pominięcie pola w PATCH zachowuje wartość. Ustawienia są wspólne dla urządzeń, nie lokalne.

### 3.2. Wersja zestawu

`VocabularyFormat = standard | picture`. Pole `vocabularyFormat` trafia do GenerationCommand, LlmGenerateDeckInput, zapisanego input generacji, `deck_versions.vocabulary_format`, DraftDto, widoku listy rodzica i KidDeckDto. Domyślnie `standard`. Wersje lekcji również zachowują wartość `standard`; picture jest dozwolone wyłącznie dla vocabulary.

Format wybiera się przy generowaniu. Ręczne tworzenie pustego zestawu pozostaje standardowe. W v1 nie ma przełączania formatu istniejącego zestawu ani konwersji standardowego materiału. Nowy szkic z opublikowanej wersji kopiuje format. Opublikowany format chroni istniejąca niezmienność wersji.

### 3.3. Sesja i zgodność klienta

Nowa sesja zapisuje w kontekście niezmienne `canRead` i `vocabularyFormat`; SessionDto zwraca obie wartości. Brak tych pól w starym kontekście oznacza `true` i `standard`. Zmiana profilu lub publikacja kolejnej wersji nie zmienia rozpoczętej sesji.

SessionInput dodaje opcjonalne `supportsPictureVocabulary: boolean`, domyślnie false. Nowy Kid UI wysyła true. Start i wznowienie sesji picture przez starszego klienta zwracają `validation` z `details.reason = picture_client_update_required`. Nowy klient waliduje tę przyczynę i wskazuje potrzebę odświeżenia; już zainstalowany starszy klient może pokazać jedynie swój dotychczasowy ogólny komunikat validation. Instrukcja wdrożenia wymaga odświeżenia klienta, nie obiecuje aktualizacji starego kodu przez odpowiedź serwera. Nie wolno cicho wracać do zadań tekstowych.

`KidValidationReason` obejmuje picture_client_update_required, vocabulary_requires_reading, non_reader_mock_test_unavailable, picture_guidance_unavailable i picture_audio_unavailable. Powody są częścią opcjonalnego ApiError.details, nie AppError.message. KidApiError zachowuje tylko walidowany reason; nie przekazuje do widoku surowych details lub danych providera. Nieznany powód ma dotychczasowy komunikat ogólny. Test HTTP i klienta potwierdza ten transport; interfejs pokazuje polski tekst i adekwatne działania retry, odświeżenie lub powrót do rodzica.

## 4. Generowanie i zatwierdzanie

Formularz generowania oferuje „Standardowy” i „Obrazkowy — bez czytania”, domyślnie standardowy. Nie ma automatycznego wyboru na podstawie wszystkich profili: zestawy są współdzielone i mogą być przypisane różnym dzieciom.

Dla picture prompt wymaga konkretnego znaczenia, możliwego do przedstawienia bez liter i podpisów: przedmioty, zwierzęta, jedzenie, proste czynności, kolory, liczby. Pomija dni tygodnia, miesiące i pojęcia wymagające abstrakcyjnego lub tekstowego wyjaśnienia. Jedna karta ma jedno jasno określone znaczenie. Gotowy obraz nie zawiera tekstu. Typy dozwolone: image, color, number; zabronione: none, sequence.

`maxItems` pozostaje górnym limitem, nie obietnicą liczby kart. Model może zwrócić mniej odpowiednich słów. Nie dopełnia zestawu nieodpowiednimi słowami ani nie zmienia tematu. Jeśli wejście zawiera listę, model wybiera tylko odpowiednie pozycje z tej listy; rodzic porównuje wynik z materiałem wejściowym w podglądzie. V1 nie dodaje listy odrzuconych słów ani dodatkowego klasyfikatora LLM.

W trybie picture surowy wynik może mieć pustą listę. Worker zapisuje wtedy stan failed i `errorCode = no_picture_material`; interfejs wyjaśnia brak materiału możliwego do pokazania obrazkiem. Nie zapisuje treści i nie przedstawia pustego zestawu jako gotowego. Pozostałe błędy walidacji są terminalne według obecnego workflow. Generacja standardowa zachowuje dotychczasowe zachowanie.

Opcja jest częścią niezmiennego polecenia ponowienia po niepewnej odpowiedzi oraz input workera. Zmiana opcji w formularzu nie może zmienić już zleconej generacji pod tym samym kluczem. Nie przebudowujemy poza zakresem dotychczasowej idempotencji.

Serwer sprawdza strukturalną poprawność i dozwolone reprezentacje. Nie deklaruje automatycznej gwarancji, że dziecko zrozumie obraz. Rodzic ogląda gotowe grafiki w istniejącym podglądzie i zatwierdza całą wersję przy publikacji; nie ma flag potwierdzenia per karta.

Publikacja picture wymaga dla KAŻDEJ karty gotowego, zatwierdzonego target_audio i kompletnego znaczenia: dla image gotowej ilustracji o zgodnym fingerprintcie; dla color/number poprawnych danych renderowania. Nie dopuszcza omitted illustration. Ominięcie ilustracji blokuje także endpoint pomijania dla picture. Edycja i ręczne dodawanie kart w szkicu picture zachowują te ograniczenia. Rodzic może usunąć nieodpowiednią kartę ze szkicu lub poprawić/regenerować obraz; opublikowany materiał pozostaje niezmienny.

## 5. Zadania i reguły silnika

| Zadanie | Publiczny prompt | exerciseType | Umiejętność |
| --- | --- | --- | --- |
| Poznaj słowo | exposure; obraz/kolor/liczba i wzorcowe audio | exposure | Brak oceny |
| Posłuchaj i wybierz | picture_listening; audio i 2–3 wizualne opcje | listening | Listening |
| Posłuchaj i powtórz | speech; reprezentacja i wzorcowe audio | speech | Pronunciation |
| Nazwij obrazek | picture_recall; reprezentacja, bez angielskiego rozwiązania | recall | Recall; pronunciation osobno |

MeaningVisual jest publicznym, walidowanym opisem z discriminatorem kind=image/color/number: odpowiednio imageAssetId (UUID), color (kanoniczny kolor) lub count (integer 1–50). Nie zawiera promptu generowania obrazu ani odpowiedzi po angielsku. LabelPl jest polskim opisem dostępności. PictureChoiceOption ma id, labelPl i visual, bez pola correct.

Sesje picture korzystają z picture_listening niezależnie od umiejętności czytania dziecka. Picture_recall dotyczy wyłącznie canRead=false. Dziecko czytające zachowuje standardowe Recall, reading, reverse_recognition, letter_completion i spelling, a obrazkowe słuchanie uzupełnia ten sam materiał.

Dla canRead=false scheduler i rekomendacje zestawów wyłączają reading i spelling, oba rozpoznawania tekstowe, uzupełnianie liter oraz pisemne przygotowanie przed sprawdzianem. Bez mikrofonu wyłączają także Recall i pronunciation. Exposure jest zawsze dozwolone. Te same możliwości obowiązują przy budowaniu rezerwacji, wyborze zadań, w API prób i przy obliczaniu recommended; niewykonywalna pisownia nie rezerwuje celu w nieskończoność. Stare oceny nie są usuwane ani zmieniane.

`listKidDecks(services, childId, options?: { microphoneEnabled?: boolean })` i KidApi.listDecks otrzymują opcjonalną możliwość mikrofonu. `GET /api/v1/kid/decks` dodaje query microphoneEnabled=true|false; brak oznacza true dla zgodności wstecznej, inne wartości to validation. Nowy kontroler wysyła stan przełącznika/odmowy i ponownie pobiera rekomendacje po zmianie (z ochroną epoch przed spóźnionym response). Tylko należny Recall przy microphoneEnabled=false nie czyni zestawu rekomendowanym. Liczenie faktu poznania materiału nadal korzysta z pełnej historii; ignorowanie niećwiczonych umiejętności nie robi ze znanej karty nowego materiału.

Wydane zadania sesji canRead=false zapisują w niezmiennym session_tasks.context `assessmentSkills`: exposure=[], picture listening=[listening], picture Recall=[recall, pronunciation], speech=[pronunciation]. startAttempt kopiuje tę listę do FrozenContext przed analizą. evaluateNonAnswer i timeout przecinają dotychczasowe assessedSkills(exerciseType) z przypiętą listą; „Nie pamiętam” dla picture Recall ocenia tylko recall, a timeout daje tylko nieoceniony recall. W finalizacji każdej próby ograniczamy grade.skills do zamrożonego zakresu, zachowując pronunciation z rzeczywistej analizy mowy. Nie odczytujemy w tym celu aktualnego profilu ani flagi mikrofonu po odebraniu próby. Brak listy w legacy zachowuje dotychczasową ocenę; standardowe pisemne Recall nadal ocenia recall i spelling. Wsparcie/retry także filtruje dozwolone exerciseTypes; nie może wrócić jako letter_completion.

Opcje muszą być różne wizualnie i znaczeniowo: wykluczamy identyczne asset_id, równe kolory/liczby, jednakowe polskie znaczenia oraz nakładające się angielskie warianty odpowiedzi. Rodzic nadal rozstrzyga podobieństwo semantyczne różnych obrazów. Chronione cele Recall nie mogą być wcześniej ujawnione w zadaniach ani użyte jako dystraktory. Tasowanie zachodzi tylko raz przy wydaniu promptu. Klucz odpowiedzi i mapa rewizji zostają prywatne. Kwalifikacja Listening liczy rozróżnialne opcje wizualne, nie brakujące option.text.

Picture_recall nie zawiera target ani target_audio. DisclosureDto dodaje opcjonalne audioAssetId. Dla kind=audio lub hint w picture Recall authorizeDisclosure pod blokadą pobiera zatwierdzone target_audio z przypiętej rewizji i potwierdza ready; zapisuje zamkniętą ekspozycję przed zwróceniem jego ID. Brak gotowego zasobu daje validation/details.reason=picture_audio_unavailable, bez oceny dziecka. Kontroler przy picture Recall najpierw autoryzuje odsłuch, następnie parsuje ID z odpowiedzi i dopiero odtwarza; nie kończy metody wcześniej z powodu braku audioAssetId w promptcie. Hint pokazuje reprezentację i odtwarza ujawniony wzorzec, a nie sam tekst. Każdy replay, także po reload i z cache, ponawia autoryzację. Pozostałe prompty i disclosures zachowują dotychczasowy kontrakt (nowe pole opcjonalne).

Odsłuch odbiera samodzielność. Powtórzenie po wzorcu może oceniać wymowę, ale nie potwierdza samodzielnego Recall. W zadaniu picture_recall zachowujemy ocenę wspomaganego Recall z independent=false; w zadaniu speech oceniana jest wyłącznie pronunciation. Niepewne STT, awaria i cisza nie są błędną wiedzą. Zatwierdzone warianty mowy zachowują obecną semantykę.

Serverowe optionTextOf i correctTextOf odczytują labelPl z walidowanych opcji picture, a text z opcji standardowych. Answer.optionText, details.confusion.expected/answered i tekst feedbacku obrazkowego Listening mają niepuste polskie znaczenia. Nie używamy pustego stringa ani angielskiego target jako zastępstwa dla poprawnej opcji picture. Prywatna mapa optionItemRevisionIds nadal wiąże pomyłkę z rewizjami; raport rodzica musi przejść istniejący ConfusionDtoSchema po błędnym wyborze.

Brak 2 bezpiecznych opcji nie prowadzi do pojedynczej odpowiedzi ani zapętlenia. Silnik wybiera inne dozwolone zadanie albo kończy sesję wcześniej. Zestaw z jednym słowem może obejmować prezentację oraz mówienie; bez mikrofonu kończy się po prezentacji. Nie obiecuje się dodatkowych ocenianych zadań, których nie można bezpiecznie wykonać.

## 6. Dostęp, utrata mikrofonu i obsługa bez czytania

Rodzic widzi wszystkie przypisania i ostrzeżenie przy niezgodnym standardowym zestawie lub lekcji. Nowa lista Kid Mode dla canRead=false obejmuje opublikowane picture ORAZ zestaw już aktywnej sesji tego dziecka, niezależnie od jego rodzaju, trybu i zgodności aktualnego przypisania. KidDeckDto dodaje `resumeOnly?: boolean` (domyślnie false): aktywny niezgodny zestaw ma true i oferuje tylko wznowienie dokładnego activeSession.mode albo zakończenie activeSession.sessionId. Nie pokazuje nowego startu/kartkówki. Lista może zawierać taki wpis nawet po dezaktywacji przypisania lub archiwizacji zestawu, bo wznowienie dotyczy przypiętej sesji, nie nowego materiału.

startSession najpierw rozstrzyga istniejącą sesję: zgodne deckId/mode i aktualne okno resume → używa snapshotu i wcześniejszej walidacji klienta picture; inna aktywna sesja → conflict z dostępną akcją resume/end. Dopiero tworzenie nowej sesji podlega ograniczeniom aktualnego canRead/formatu, assignment i archiwum. Nowy start standard/lesson oraz mock_test dla false daje validation/details.reason=vocabulary_requires_reading albo non_reader_mock_test_unavailable. Starej sesji nie zamykamy automatycznie z powodu zmiany flagi.

KidDeckDto dodaje `coverVisual: MeaningVisual | null`. Serwer wybiera pierwszą reprezentację po position z wersji publikacji; dla resumeOnly używa wersji przypiętej sesji. picture ma poprawną reprezentację, standard/lesson może mieć null. Klient nie pobiera prywatnej rewizji, aby zgadywać okładkę.

`POST /api/v1/kid/sessions/:id/disable-microphone` jest idempotentną operacją pod wspólną blokadą sesji. W v1 służy treningowi canRead=false; dla innych sesji validation. Ustawia microphoneEnabled=false i zapisuje techniczną obserwację w mutable learning_sessions.context jako `microphoneDisabledTaskIds: string[]`; NIE zmienia session_tasks.context, którego pilnuje trigger. Czyści rezerwacje Recall niewykonywalne bez mikrofonu; wydany pomijany cel dodaje do settledChecks tylko w bieżącej sesji. Nie zmienia historii należności na przyszłe sesje.

Aktualne issued recall/speech bez processing zmienia tylko state na skipped, bez próby/oceny. Dla processing oznacza zadanie na liście i pozwala zakończyć już przyjętą analizę w zamrożonym zakresie. Finalizacja (również leniwy timeout) najpierw zapisuje właściwą ocenę/feedback; jeśli task pozostał issued, wspólny helper kończy go jako skipped. Jeśli wynik już zamknął zadanie, jego stanu nie zmienia. Helper jest idempotentny, zwalnia rezerwację i działa także w nextTask przed zwróceniem issued task, aby odzyskać stan po utraconej odpowiedzi. Nie zmienia promptu, klucza, context zadania ani liczby wydanych zadań. Nowe próby audio po disable są odrzucane; odczyt/ponowienie istniejącego clientAttemptId i finalizacja przyjętej próby nadal działają.

TaskDto dodaje opcjonalne pendingAttemptId: UUID, wyłącznie dla issued zadania z próbą processing. Pod blokadą serwer odczytuje ID aktualnej próby; po reload kontroler pokazuje oczekiwanie i polluje istniejący readAttempt, bez uruchamiania mikrofonu i bez nowej próby. Po zakończeniu tej próby przechodzi do tasku niegłosowego lub końca. Kolejne zadania nie wymagają mikrofonu. Powtórzenie disable nie tworzy kolejnego pominięcia. Po zakończeniu sesji conflict. UI najpierw anuluje lokalne nagrywanie i zwalnia bufory.

Przepływ nie wymaga czytania: awatar/profil, wizualna identyfikacja zestawu, ikonowe działania, mówione polecenia, feedback i podsumowanie. Nazwy i podpisy pozostają jako pomoc dla rodzica oraz etykiety dostępności, ale nie warunkują odpowiedzi. Dla niejednoznacznych awatarów rodzic otrzymuje ostrzeżenie i może skorzystać z istniejącego linku konkretnego profilu. Okładką picture jest pierwsza reprezentacja słowa z przypiętej publikacji; nie odczytujemy automatycznie angielskich tytułów zestawu ani słów z listy przed startem.

Polski katalog stałych wskazówek korzysta z istniejącego TTS, media_assets i niezmiennego MediaStore. Worker przygotowuje katalog przy starcie i zmianie konfiguracji, a endpoint `GET /api/v1/kid/ui-audio` jedynie zwraca gotowość i gotowe asset_id; nie generuje przy odczycie. Stałe keys: profile_select, deck_select, exposure, listening, speech, recall, correct, partial, incorrect, unevaluated, skip, dont_remember, end, retry, mic_unavailable, audio_unavailable, summary. Źródłem tekstów jest wspólny katalog messages. Nie wysyłamy do TTS nazw ani identyfikatorów dzieci.

Zasoby katalogu są wspólne i przygotowane wcześniej, adresowane przez fingerprint tekstu/locale/provider/model/voice/format; nie mają revision_assets ani nowej tabeli. Wykorzystują obecne media jobs związane z asset_id. Nowe metadane zawierają `purpose = kid_ui_guidance` i walidowany UiAudioKey. supersedeDisabledLessonTts rozpoznaje ten marker i nie odrzuca takiego TTS za brak revision_assets; dotychczasowa ochrona porzuconego/wyłączonego TTS lekcji zostaje. Nie zmieniamy zasady dla innych osieroconych mediów.

prepare używa istniejącego ready asset o tym samym fingerprintcie; jeśli go nie ma, ponownie wykorzystuje pending z poprawnym markerem UI lub tworzy kolejną generationNumber z markerem. Nie zmienia immutable metadata gotowego zasobu i nie przejmuje nieoznaczonego pending TTS lekcji. Po wyczerpanym failed katalogu ponowne uruchomienie workera po usunięciu przyczyny tworzy następną generację; GET nie wykonuje retry. Dwa workery serializują przygotowanie przez obecny advisory lock fingerprintu. Test przechodzi rzeczywistą executeMediaAsset/fake TTS i potwierdza gotowość wszystkich 17 kluczy; wspólne fingerprinty mogą współdzielić asset. Osobna regresja zachowuje odrzucanie TTS lekcji z wyłączonym audio.

Gotowość UI audio jest warunkiem nowego startu canRead=false; brak katalogu daje validation/details.reason=picture_guidance_unavailable i informacją dla rodzica. Nie wpływa na standardowe sesje dzieci czytających.

Polecenie, wzorzec i feedback są odtwarzane kolejno. Świadome kliknięcie Start i przycisk odsłuchu obsługują blokadę autoplay. Audio zatrzymuje się przed nagrywaniem, zmianą zadania i wyjściem. Odsłuch materiału nadal wymaga autoryzacji disclosures; neutralne wskazówki UI nie ujawniają słówek. Przy awarii dźwięku dostępne są ikonowe retry i zakończenie; bez lokalnej fałszywej oceny. Podsumowanie może mówić neutralnie „Na dziś koniec”; nie wymaga czytania trudnych słów i nie chwali niepoprawnej wiedzy.

## 7. Raporty, API → MCP → skill i wdrożenie

Panel rodzica zachowuje wszystkie istniejące wyniki; przy profilu nieczytającym opisuje reading/spelling jako niećwiczone w tym trybie, a nie jako nową zaległość. Nie ukrywa dawnych trudności ani dawnych ocen. Rozumienie, Recall i wymowa pozostają osobnymi wynikami. Podsumowanie sesji nie zaczyna wyliczać nowego wskaźnika trwałego opanowania.

Learning-overview zachowuje pełny mianownik opublikowanego zestawu, pięć umiejętności i istniejący schemaVersion. Nie wycina reading/spelling i nie dodaje canRead ani nowego formatu do tego raportu w v1. Skill MCP dostaje notę: brak ocen reading/spelling może wynikać z trybu nauki bez czytania i nie oznacza zaległości; raport nie pozwala samodzielnie ustalić, które dziecko korzysta z tego trybu. Nadal wyłącza lekcje i oznacza szacowany czas. Eksport schematu, walidacja, HTTP oraz standardowy klient Streamable HTTP są sprawdzane na fikcyjnych danych. Dokumentacja wyjaśnia brak nowego narzędzia MCP i brak zmiany mianownika.

Wdrożenie: migracja zgodna ze starym kodem → worker obsługujący picture i przygotowujący UI audio → web i nowy Kid UI. Nowy wariant nie jest dostępny rodzicom do czasu aktualizacji workera. Starsze kolejki pozostają standardowe. Nie zakładamy, że aktualizacja pliku skilla aktualizuje instalację Hermesa.

W v1 nie zmieniamy automatycznie rodzinnych profili ani przypisań. Rodzic włącza ustawienie po odbiorze funkcji. Starsze zestawy i historia pozostają zachowane.

## 8. Odbiór i workflow

Implementacja wymaga zapisanych artefaktów do przeglądu, executing-plans, sprawdzonej izolacji, realnego RED→GREEN, dziennika i jednego końcowego niezależnego review całego zakresu. Review: najmocniejszy dostępny model z wyłączeniem GPT Astra. Delegacja implementacji tylko za wyraźną zgodą. Critical i Important rozwiązane przed PR; scalanie przez właściciela wyłącznie Squash and merge.

Testy obejmują: standardowe profile/warianty; generator i retry; publikację i media; scheduler, rezerwacje i kontekst sesji; dwie przeglądarki i reload; awarie mikrofonu/dźwięku/sieci; pojedyncze słowo; historię i usunięcie profilu; MCP; cały przepływ mobilny. Regresje R01–R07 są mapowane w planie.

Próba na rzeczywistym telefonie i z dzieckiem jest osobnym dowodem użyteczności oraz jakości ilustracji/STT, a nie wynikiem samych testów automatycznych. Brak takiego dowodu należy jawnie podać w raporcie.

Plan wykonania: `../plans/2026-10-14-picture-vocabulary.md`. Dziennik: `../progress/2026-10-14-picture-vocabulary.md`.
