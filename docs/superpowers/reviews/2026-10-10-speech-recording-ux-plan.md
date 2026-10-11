# Niezależny review projektu i planu UX nagrywania

Data: 2026-10-10. Recenzent: dedykowany subagent `speech_ux_plan_review`, model `gpt-6.1-sol`, reasoning effort `xhigh`; najbardziej zaawansowany dostępny model z wykluczeniem GPT Astra. Review read-only, bez dalszej delegacji.

## Zakres i dowody

Baza/HEAD podczas review: `b7f5f09c2144b1a484e2b58cd713513d0a63da83`. Cały zakres dokumentacji jest niezacommitowanym diffem na `docs/speech-recording-ux-plan`: projekt, plan i checklista `2026-10-10-speech-recording-ux*`. Nie jest to review implementacji aplikacji ani tylko ostatniego commita.

Cel: hold-to-record i dostępność, wskaźnik mikrofonu, rozpoznany tekst, uczciwe rozdzielenie niepewności/ciszy/awarii/wymowy, wiarygodne fragmenty, inline wynik i odsłuch z zapisem ekspozycji. Porównanie z bazowymi kontraktami, domeną, modułami sesji/mowy/ekspozycji, adapterem przeglądarki oraz testami. `git diff --check` PASS. Dla zakresu Markdown nie uruchamiano nowych testów produktu.

Pierwsze uruchomienie recenzenta zakończył limit usługi, bez review. Po poleceniu właściciela kontynuacji ponowiono zadanie w tym samym dedykowanym subagencie.

## Runda 1 — po poprawkach

Critical: brak. Important: 4. Minor: 1.

Mocne strony od recenzenta: jasna granica zgody na implementację, konkretny cykl mikrofonu, zachowana bramka STT/historia/budżet, ograniczona autoryzacja odsłuchu oraz wyłączenie trace dla audio.

1. **Important: spóźnione fetch/blob mogą rozpocząć wzorzec po stop.** Zweryfikowano w `BrowserAudioPlayer.play/stop`. Przyjęto: §1 projektu i zadanie 3 planu wymagają generacji/AbortController, kontroli po await, neutralnego domknięcia Promise, cleanup object URL oraz testów oddzielnie dla fetch/blob i start/next/end.
2. **Important: ekspozycja pokazanego wariantu/rozpoznanego innego słowa.** Zweryfikowano `discloseFeedback` zapisujące tylko kanoniczny klucz i własne klucze wariantów w `target-key.ts`. Przyjęto: §2 projektu, nowe helpers normalizacji/feedbackExposureKeys i zadanie 1; test sofa/couch w innym zestawie, wiarygodny heardText, pełne pieczętowanie submit/read/retry i niezmienność wcześniejszej kwalifikacji.
3. **Important: ok STT z text=null pominięte przez tabelę ciszy.** Zweryfikowano w Azure STT i jego testach. Przyjęto: tabela jawnie klasyfikuje ok+null jako no_speech/not_applicable; zadanie 1 dodaje domenowe/integracyjne asercje bez tekstu/wzorca/confusion/incorrect.
4. **Important: każdy ErrorType wycina mapowalne fragmenty partial.** Zweryfikowano w adapterze Azure i [oficjalnym Microsoft Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment#result-parameters). Przyjęto: null/None/Mispronunciation dopuszczają pozostałe bramki mapowania; Omission/Insertion/nieznane typy neutralnie. Zadanie 2 ma pozytywny partial+Mispronunciation i negatywne strukturalne typy, bez sylabizacji i zmiany progów.
5. **Minor: null feedback nieujęty w sygnaturze helpera i teście.** Zweryfikowano nullable `LearningScreen.feedback.dto`. Przyjęto: helper przyjmuje FeedbackDto|null, neutralny fallback bez zgadywania przyczyny; modality identyfikuje próbę audio niezależnie od nowych pól.

Dodatkowy self-review po uwagach doprecyzował brak lokalnego score'u jako neutralny konkretny fragment (inne pewne fragmenty mogą być ocenione) oraz interfejs kontrolera/persistencji trybu hold/toggle. Wszystkie uwagi rozwiązano w dokumentacji; implementacja i dowody RED→GREEN są przyszłymi zadaniami.

## Declined to judge

- Jakość mapowania na rzeczywistym głosie dziecka: wymaga osobnej autoryzowanej próby.
- Działanie na rzeczywistym telefonie/tablecie: brak implementacji/urządzenia w tym review.
- Sylabizacja, nowe progi, scheduler i budżet: poza uzgodnionym zakresem.
- GREEN i gotowość wdrożenia aplikacji: obecny zakres to wyłącznie projekt i plan.

Executor podtrzymuje te granice i wpisuje wymagane dowody urządzenia/regresji do planu; nic nie jest uznane za wykonane ani odłożone po cichu.

## Runda 2

Niezależny recenzent ponownie przeczytał cztery dokumenty i potwierdził zamknięcie 4 Important oraz Minor z rundy 1. Werdykt: **dokumentacja gotowa do PR**. Critical: 0; Important: 0; Minor: 1 (mapa plików i krok RED preferencji w zadaniu 4).

W trakcie rundy wskazał dodatkową Minor: neutralnie rozwiązany anulowany play nie może tworzyć `audio_played`. Uzupełniono generację kontrolera, helper stopPlayback oraz osobny test; recenzent potwierdził zamknięcie tej uwagi przed werdyktem.

Ostatnią Minor redakcyjną również poprawiono: zadanie 4 wymienia session-controller.ts i jego test, scenariusze preferencji są w kroku RED i jawnej komendzie unit, a GREEN uruchamia te same pliki. Końcowy raport recenzenta jeszcze wymieniał tę uwagę; executor zweryfikował jej poprawienie w aktualnym dokumencie po raporcie. Nie pozostały odłożone uwagi. Ta kontrola redakcji była własna; główny dwurundowy przegląd zakresu był niezależny.

Końcowa weryfikacja dokumentacji: odnośniki lokalne i istniejące ścieżki plików sprawdzone; brak TODO/TBD; zakres wyłącznie czterech dokumentów Markdown; git diff --check PASS. Testów aplikacji nie uruchamiano dla tego zakresu, zgodnie z wyjątkiem dokumentacyjnym AGENTS.md. Zatwierdzenie zapisanej specyfikacji i planu nadal należy do właściciela.
