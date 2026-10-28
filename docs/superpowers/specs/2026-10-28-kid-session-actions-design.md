# Uproszczenie akcji sesji dziecka

Projekt zaakceptowany przez właściciela w rozmowie 2026-10-28.

## Cel i zakres

Usunąć migający komunikat „Chwilka, przechodzimy dalej…” i przycisk „Pomiń” z ekranów dziecka. Skrócić „Nie pamiętam — pokaż” do „Nie pamiętam”; w formularzach ustawić tę akcję obok większego przycisku „Sprawdź”.

## Rozważone podejścia

- Krótki tekst „Nie pamiętam”: jednoznaczny i mniejszy niż obecna etykieta — wybór właściciela.
- Ikona ze słowami: czytelna, ale zajmuje więcej miejsca.
- Sama ikona pytajnika: kompaktowa, lecz może sugerować instrukcję lub pomoc zamiast deklaracji trudności.

## Zachowanie

- Usuwamy element komunikatu przejścia, zachowując wewnętrzny stan przejścia i zabezpieczenia przed wielokrotną odpowiedzią.
- Usuwamy zwykłą możliwość pominięcia zadania. Dotyczy to nauki, lekcji i kartkówek oraz przycisków przy feedbacku.
- „Nie pamiętam” zachowuje obecny przepływ: nauka autoryzuje ujawnienie na serwerze, a potwierdzenie zapisuje trudność; kartkówka zapisuje trudność bez rozwiązania.
- Problem techniczny pozwala ponowić operację lub wybrać neutralne „Dalej”, korzystające z istniejącej operacji przejścia bez oceny wiedzy. Nie jest to zamiana etykiety każdego dawnego „Pomiń”: akcja ma występować tylko przy przeszkodzie technicznej.
- Brak lub odmowa mikrofonu nie może zablokować wydanego zadania mowy. Potrzebna jest neutralna droga kontynuacji także bez feedbacku próby.

## Granice i ograniczenia

Właścicielem zmiany jest `packages/kid-ui`, etykiety należą do `packages/contracts/src/messages.ts`. Rozszerzamy wspólny `ExerciseFrame`, korzystając z `ActionButton`. Bez nowych zależności, API, schematu bazy lub reguł oceniania; istniejące transakcje i historia pozostają zachowane. Techniczna operacja `skip` pozostaje dostępna dla zgodności i neutralnego przejścia po awarii.

Jeden rząd akcji formularza: „Sprawdź” główne, „Nie pamiętam” pomocnicze. Cele dotykowe co najmniej 48 px, główna akcja co najmniej 54 px. Układ ma działać z klawiaturą, w portrait, landscape, na tablecie i desktopie; dłuższa treść ma pozostać osiągalna przewijaniem.

## Weryfikacja i swoboda implementacji

Testy komponentów i kontrolera potwierdzą brak „Pomiń”, zachowanie ujawnień, błędy techniczne i blokadę podwójnej wysyłki. Playwright sprawdzi geometrię, wolną odpowiedź sieci i kontynuację bez mikrofonu. Dobór odstępów oraz proporcji szerokości przycisków należy do implementacji w ramach obecnych tokenów. Test fizycznego telefonu pozostaje osobnym dowodem.
