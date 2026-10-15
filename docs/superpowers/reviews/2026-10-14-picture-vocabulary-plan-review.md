# Niezależny review planu zestawów obrazkowych

Data: 2026-10-14. Zlecenie właściciela: sprawdzić plan przed wykonaniem przez słabszy model.

Recenzent: dedykowany agent `/root/review_picture_plan`, `gpt-6.1-sol`, reasoning `xhigh`; najmocniejszy dostępny poza GPT Astra. Workflow requesting-code-review/code-reviewer.md. Review read-only, bez podagentów recenzenta i bez testów nieistniejącej implementacji.

Zakres: cała specyfikacja, plan i dziennik `2026-10-14-picture-vocabulary`, jako nowo dodane nieśledzone pliki; porównanie z rzeczywistym kodem. BASE=HEAD=6faf2793d21e8cf98dcbd7cc655ccebc008393f6. Pusty git diff dla untracked nie stanowił zakresu review; recenzent przeczytał treść plików.

## Pierwsza runda — wynik

**Ready for weaker-model implementation: No.** Critical: 0, Important: 9, Minor: 3.

Mocne strony wskazane przez recenzenta: pozostawienie picture w vocabulary i wspólnej historii; ochrona retry i publikacji całego zestawu; Listening bez option.text; snapshot sesji, rozdzielenie Recall/wymowy i oddzielenie E2E od próby z dzieckiem; RED→GREEN i R01–R07.

Poniższe numery linii odnoszą się do wersji PRZED poprawkami pierwszej rundy.

### Important i zweryfikowane działania

1. **Katalog audio odrzucony przez worker** — plan:84; generation.ts:450. supersedeDisabledLessonTts uznaje także zero revision_assets za porzucony TTS. Potwierdzono odczytem executora. Plan zadania 4 i projekt rozróżniają purpose=kid_ui_guidance + walidowany uiAudioKey; chronią dotychczasową regułę lekcji/orphan, przewidują recovery po failed i test realnej executeMediaAsset dla wszystkich 17 kluczy.
2. **Brak transportu audio po ujawnieniu Recall** — projekt:72; plan:138; contracts/kid.ts:250 i controller:656. Potwierdzono brak ID w DisclosureDto i early return przed autoryzacją. Dodano opcjonalny audioAssetId response po ready check i sealed exposure, obsługę hint/play/replay/reload oraz test rzeczywistego HTTP → DTO → playback. Początkowy prompt nadal nie ujawnia ID.
3. **Pisownia oceniana w „Nie pamiętam”/timeout** — plan:96/130; evaluate.ts:157 i attempts.ts:800. Potwierdzono skillsForExercise(recall)=[recall,spelling]. Dopisano niezmienny scope task → FrozenContext, ograniczenie grade przed zapisem, non-answer i timeout oraz zachowanie legacy. Testy zabraniają spelling i letter_completion dla picture Recall, zachowując standardowe pisemne Recall.
4. **Puste teksty opcji uszkadzają raport** — plan:125/127; attempts.ts:141, reporting.ts:206. Potwierdzono optionTextOf/correctTextOf czytające wyłącznie text i details.confusion z pustym answered. Plan używa labelPl dla picture i text dla standard, obejmuje zapis answer, feedback, confusion i parse ProgressDto po błędnej odpowiedzi.
5. **Disable-microphone narusza snapshot lub blokuje zadanie** — projekt:80; plan:128; guard_task_snapshot SQL:98 i attempts.ts:383. Potwierdzono zakaz zmiany task.context, brak zwalniania rezerwacji przy skip bez próby i issued po błędzie/technicznym wyniku pending. Techniczny marker trafił do mutable context SESJI. Wspólny completeDisabledVoiceTask zmienia tylko state, rozlicza rezerwacje i domyka issued po finalizacji/timeout; TaskDto.pendingAttemptId umożliwia reload/poll. Testy obejmują sukces, pierwszy błąd, niepewne STT, timeout, dwóch klientów i utratę response.
6. **Ukrycie aktywnej sesji po zmianie profilu** — projekt:78; controller:348. Potwierdzono zależność odkrywania konfliktu od listDecks. Dodano wyjątek aktywnej sesji, resumeOnly, dokładny activeSession.mode, możliwość zakończenia, przypiętą wersję i priorytet resume przed walidacją nowych startów. Scenariusze obejmują standard/lesson/mock, reload, archive i assignment inactive.
7. **Rekomendacje nie znają stanu mikrofonu** — projekt:68; plan:130. Potwierdzono dotychczasowe listDecks(childId) bez dodatkowej możliwości. Query microphoneEnabled=true|false ma default true dla legacy; sygnatury serwera/klienta i odświeżenie przełącznika są jawne. Test: wyłącznie Recall należny + mic false → recommended false. Fakt poznania nadal pochodzi z pełnej historii.
8. **Okładka bez DTO** — plan:48/142. Potwierdzono brak reprezentacji w KidDeckDto i query. Dodano coverVisual: MeaningVisual|null, wybór po position z publikacji/przypiętej sesji i test dwóch zestawów oraz serializacji.
9. **Powód validation tracony w transporcie** — projekt:37/86; KidApiError/client.ts:30. Potwierdzono, że errorResponse serializuje details, ale nie message, a klient odrzuca details. Zdefiniowano enum pięciu reasons i details.reason, walidację w KidApiError, mapowanie komunikatów/akcji i test HTTP. Starszy klient zachowuje ogólny validation — dokumentacja nie obiecuje, że jego stary kod wyświetli nowy komunikat.

### Minor

- Plan:60 — executeDeckGeneration zastąpiono właściwym istniejącym executeGeneration.
- Plan:136 — dopisano ExerciseView.tsx i dokładny sposób fixture: fake picture dla kolorów/liczb, jawne queue behavior bez zmian, rozszerzenia Kid UI fixture i dekodowalny syntetyczny WAV bez danych dziecka. Realna jakość TTS nadal poza dowodem E2E.
- Plan:42/72 — walidator i MeaningVisual powstają już w zadaniu 1; generacja i publikacja używają go bez przejściowej duplikacji.

Wszystkie uwagi przyjęto po sprawdzeniu źródeł zgodnie z receiving-code-review. Nie dokonano zmian zachowania aplikacji. Nowe interfejsy są decyzjami w planie; nie przedstawiamy ich jako działającego kodu.

### Declined to judge

- Jakość rzeczywistych ilustracji, polskiego TTS i dziecięcego STT: potrzebne próby providerów/urządzenia.
- Wyniki nowych testów/migracji: implementacja nie istnieje, review dotyczy projektu i wykonalności.
- Wdrożenie konfiguracji rodzinnej i zainstalowanego skilla Hermesa: osobno autoryzowany etap.

## Ponowny review

Recenzent przejrzał całe cztery poprawione artefakty przy niezmienionym HEAD. Potwierdził zamknięcie wszystkich 9 Important i 3 Minor pierwszej rundy.

**Ready for weaker-model implementation: Yes.** Critical: 0. Important: 0. Pozostała jedna Minor redakcyjna: zapis „po wzorcu ocenia wymowę, nie Recall” mógł sugerować usunięcie wspomaganej oceny Recall. Recenzent zalecił „Powtórzenie po wzorcu może oceniać wymowę, ale nie potwierdza samodzielnego Recall”. Autor zweryfikował zgodność z obecną kwalifikacją i wprowadził tę redakcję, dodatkowo wskazując zachowanie assessment Recall z independent=false w picture_recall oraz asercję regresji. Speech nadal ocenia tylko pronunciation.

Po tej drobnej redakcji autor wykonał odbiór spójności dokumentów i formatowania; nie uruchamiano kolejnej pełnej rundy, ponieważ nie zmieniły się interfejsy ani przejścia stanu ocenione przez recenzenta. Brak odłożonych uwag do planu.

Drugie Declined to judge zachowuje ograniczenia pierwszej rundy i dodaje niezwiązany dokument `2026-10-14-parent-panel-redesign-design.md` jako poza zakresem. Nie modyfikowano tego dokumentu.

Werdykt dotyczy gotowości PROJEKTU I PLANU dla słabszego wykonawcy, nie poprawności niewykonanego kodu. Nie zastępuje zgody na wykonanie ani końcowego niezależnego review implementacji. Nie wykonano commita, push, PR, migracji ani wdrożenia.
