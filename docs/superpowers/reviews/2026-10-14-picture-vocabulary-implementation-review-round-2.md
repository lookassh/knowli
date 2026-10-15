# Niezależny przegląd implementacji zestawów obrazkowych — runda 2

Data: 2026-10-14  
Recenzent: dedykowany `/root/independent_picture_review`  
Model: `gpt-6.1-sol`, reasoning xhigh  
Zakres: `6faf2793d21e8cf98dcbd7cc655ccebc008393f6..182ee131dfc974fef4f64498555e8a6aebeb9346`, bieżący diff oraz nowe pliki implementacji. Review było niezależne i read-only.

## Mocne strony

- Wcześniejsze uwagi Important zamknięto: obrazkowe alternatywy Listening, rezerwacje, disable/processing, wyścigi odpowiedzi i retry katalogu audio.
- Mówione zadanie można pominąć; ekspozycja ma ikonę potwierdzenia, a teksty liczebników używają wspólnego katalogu i polskiej odmiany.
- Odtwarzanie testowe używa natywnego `HTMLAudioElement.play` i zdarzenia `ended`.
- Ścieżka nagrywania przechodzi przez rzeczywisty kod BrowserRecorder, przygotowanie WAV i API; urządzenia oraz platformowe źródło audio są zastąpione.
- Kontrakty, publikacja, niezmienność mediów, ekspozycje i ograniczenia oceny zachowują uzgodnione granice.
- MCP zachowuje pięć umiejętności, mianowniki i `schemaVersion=1`; hashe skilla i schematu odpowiadają manifestowi.

## Znalezisko Minor

**Aktywna sesja zerujeła widoczne gwiazdki zestawu.** `packages/server/src/modules/kid.ts` zwracało `independentlyRecalledCount: 0` dla każdej aktywnej wersji vocabulary, mimo policzonego stanu przypiętej wersji. Po reloadzie lista dziecka pokazywała zero gwiazdek do końca sesji; historia i raport rodzica pozostawały poprawne. Zalecono zachowanie licznika wersji przypiętej do sesji.

Critical: 0. Important: 0. Minor: 1. Werdykt recenzenta: Ready to merge? Yes, po uwzględnieniu drobnej regresji.

## Odpowiedź i naprawa

Uwaga została przyjęta. Test integracyjny dodano przed poprawką i zaobserwowano RED: oczekiwano 1 opanowanego elementu, a aktywna lista zwróciła 0. Kod zwraca teraz policzony licznik dla przypiętej wersji, również dla sesji aktywnej niewidocznej w standardowej liście. GREEN: test celowany 1/1 i pełne integration 39/39 plików, 387/387 testów. Testy pełne unit 1109/1109, typecheck, build oraz picture E2E 7/7 także przechodzą. Osobny recenzent ma potwierdzić finalną poprawkę i cały zakres.

## Ograniczenia odbioru

Recenzent nie oceniał naturalności TTS, jakości ilustracji ani rozpoznawania prawdziwej mowy dziecka. Nie wykonano fizycznego urządzenia ani odbioru z dzieckiem. Wdrożenie i aktualizacja zainstalowanego klienta Hermesa pozostają osobne.

## Aneks końcowy po poprawkach review — 2026-10-15

Po rundzie 2 recenzent wskazał dalsze przypadki brzegowe w liczniku aktywnej sesji, ponownej próbie po timeoutcie oraz błędzie sieci odtwarzania. Poprawki wykonano z TDD RED→GREEN:

- Progress aktywnej sesji bierze pod uwagę przypiętą vocabulary wersję, a lekcje są wykluczone jawnie przez `deckKind`; test lekcji chroni przed dekodowaniem jej jako zestawu vocabulary.
- Po lazy finalizacji/wyłączeniu mikrofonu próba odświeża stan zadania i bezpiecznie odrzuca konflikt dla zadania terminalnego. Test potwierdza brak drugiej próby i błędnej oceny wiedzy.
- Błąd sieci picture Recall przechodzi do komunikatu offline i ścieżki retry; ponowienie ponownie autoryzuje audio.

Niezależny recenzent ponownie przeczytał poprawiony kod, zweryfikował retry audio probe i nie znalazł otwartych findings. Końcowy werdykt po pełnym E2E oraz wpisie do dziennika: **Ready to merge — Yes; Critical 0, Important 0, Minor 0.**

Końcowa weryfikacja: unit 116 plików/1110 testów, integration 39 plików/387 testów, E2E 175/175 (7.3 min), MCP 8/8, typecheck, build, eksport schematu bez zmiany wygenerowanego kontraktu oraz `git diff --check` — PASS. Nie sprawdzono fizycznego urządzenia, naturalności TTS ani odbioru z dzieckiem.
