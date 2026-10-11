# Niezależny review planu redesignu Kid UI

**Data:** 2026-10-11. **Tryb:** dedykowany subagent-recenzent, read-only, model jawnie `gpt-6.1-sol`, reasoning `xhigh`; najbardziej zaawansowany dostępny model poza GPT Astra w bieżącym kliencie.

**Zakres:** spec `2026-10-11-kid-ui-redesign-design.md`, plan `2026-10-11-kid-ui-redesign.md`, dziennik planowania; pierwotny staged diff oraz późniejsze niezacommitowane uzupełnienia. Baza i HEAD przed commitem dokumentacji: `3efdc168181d1922cadcf8c0042dbdb548d6ba7b`. Review porównał plan z aktualnym kodem i testami, a nie tylko z makietą.

## Pierwszy wynik

Critical: 0. Important: 2. Minor: 2. Verdict: po poprawkach.

1. **Important — sukces treści vs brak oceny wymowy.** Plan mylił neutralne niepewne STT z serwerowym `great` dla poprawnej treści i awarii wymowy. Obecny `speech-feedback-view.test.ts` i domenowy `feedback.test.ts` wymagają zachowania pochwały treści. `content_matched` ze speech miał ponadto istniejący pozytywny ton, sprzeczny z ogólną asercją planu „never renders success”.
2. **Important — pinch-zoom.** Interfejs height/offsetTop bez jawnej decyzji dla scale/panning nie spełniał wyjątku dostępności przy powiększeniu gestem. 200% fontu nie zastępuje pinch-zoom.
3. **Minor — sekwencje fixture.** Jeden task/attempt nie opisywał końca `next→204`, processing/completed i mock summary.
4. **Minor — stary test dialogu.** Plan powinien wprost wskazać `kid-flow.spec.ts` około linii 415, który wymagał blokady body i modalnej izolacji focusu.

## Weryfikacja i poprawki

Zastosowano `receiving-code-review`: porównano uwagi z `speech-feedback-view.ts`, jego testami, `server/domain/feedback.test.ts`, `api/client.ts` i testem popup w `kid-flow.spec.ts`.

- Zachowano dokładnie obecną semantykę `describeSpeechFeedback`: `great`/`capitalization_hint` może chwalić ocenioną treść mimo braku oceny wymowy; `content_matched` z matched speech zachowuje ton treści i „To właściwe słowo.”, bez „Świetnie!” i bez deklaracji poprawnej wymowy. Nie zmienia się domeny ani mapowania w ramach redesignu.
- Dodano `scale`/`zoomed`, naturalny flow przy scale > 1.01, brak blokady panning/scroll, powrót bez remountu, jednostkowe asercje i fizyczny odbiór powiększenia na S25.
- Fixture otrzymało kolejkę tasków z null jako 204, kolejkę attemptów do pollingu i `MockTestSummaryDto`/GET mock-test-summary. Nieznana odpowiedź fixture ma jawnie przerywać test.
- Zadanie 4 wskazuje adaptację konkretnego testu modalnego z zachowaniem długiej treści, retry i recovery.

## Ponowny niezależny przegląd

Recenzent potwierdził: **Critical 0, Important 0; oba wcześniejsze Important i oba Minor rozwiązane. Plan gotowy do przedłożenia właścicielowi do akceptacji.**

W końcowej odpowiedzi pozostała drobna uwaga Minor: filtr RED Zadania 1 pomijał test zoomu. Został poprawiony na `session frame|pinch zoom`, z jawnym wymaganiem tego samego zestawu dla GREEN. To zmiana wyłącznie dokumentowanej komendy; odczytano jej finalną treść i ponownie sprawdzono diff. Brak odłożonych uwag w planie.

## Declined to judge i ograniczenia

- Działanie rzeczywistej klawiatury, PWA i S25: jeszcze brak implementacji i dowodów urządzenia.
- Jakość providerów STT/wymowy: poza zakresem redesignu.
- Aktualny GREEN aplikacji/PostgreSQL: testów aplikacji nie uruchomiono przy review dokumentacji.

Review planu nie zastępuje późniejszego niezależnego review całej implementacji. Przed implementacją właściciel nadal czyta i zatwierdza zapisany plan/spec.
