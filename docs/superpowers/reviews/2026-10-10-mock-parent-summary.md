# Review: kompaktowe podsumowanie próbnej kartkówki dla rodzica (2026-10-10)

## Zakres

Gałąź `feature/mock-parent-summary`, baza `b7f5f09` (origin/main). Karta rodzica
„Postępy → Próbne kartkówki" przechodzi na nowy widok z PR #35: nagłówek
X/Y · % + 6 gwiazdek (Y = zaplanowana porcja), kompaktowe kolorowe wiersze słów,
szara linia informacji rodzica. Reużycie funkcji punktujących z `@learning/kid-ui`.

## Commity

- `64d7c9f` feat: compact word review with score header for parent mock test report
- `97fa0fd` fix: review fixes for parent mock report (independence, gap reasons, docs)

## Runda 1 — niezależny recenzent (subagent, GLM-5.3 = najmocniejszy dostępny; ListModels: tylko GLM-5.3/Flash, brak modelili GPT Astra, więc wykluczenie spełnione trywialnie)

Werdykt: **With fixes** (0 Critical, 2 Important, 5 Minor).

### Important 1 — nagłówki kid/rodzic przy próbach niepełnych + mylące komentarze

Recenzent słusznie zauważył, że zadania kartkówki powstają na żądanie, więc po
przerwaniu omówienie dziecka pokazuje tylko wydane zadania (np. 0/1), a raport
rodzica planowaną porcję (0/3). Wniosek o niezgodności nagłówków przyjęty
co do mechanizmu; **odrzucona** propozycja zmiany serwerowej (odrębny reason dla
niewydanych slotów) i ograniczania nagłówka, z dowodami:

- SPEC §19.1: „Przerwanie lub timeout zachowują otrzymane odpowiedzi, a resztę
  oznaczają jako niesprawdzoną" — raport MA pokazywać całą planowaną porcję
  jako niesprawdzoną; to zachowanie jest spec-aligned.
- Zmiana serwerowa to rozszerzenie zakresu bounded task bez potrzeby (YAGNI).

Wykonano minimum wymagane: komentarze `mock-report-words.ts` opisują teraz
semantykę dokładnie (zaplanowane sloty vs wydane zadania; równość nagłówków
dla prób ukończonych) + zdanie w SPEC §19.1 o przypadku przerwanym.

### Important 2 — niezgodność z §19.1: samodzielność przy błędnych, przyczyny braków, aktualizacja SPEC

Przyjęto w całości:

- samodzielność i przyczyna także przy ocenach błędnych (priorytet przyczyny
  z odpowiedzi poprawnej, gdy kilka wierszy bez samodzielności) + testy,
- zagregowana linia przyczyn braków słów poza porcją (per słowo; priorytet
  not_known > missing_audio > insufficient_options > outside_portion) + testy
  + asercja e2e,
- SPEC §19.1: akapit raportu przepisany pod nowy widok (wskaźnik pełnego
  mianownika liczników per umiejętność pozostaje; pełny status opanowania
  talii wskazany w sekcji postępu słów).

### Minory

- M1 (globalny `button { font-family }` z kid-ui na trasach rodzica): **wykonano**
  — zeskanowano hosty przycisków kid-ui (wszystkie wewnątrz `main.kid-screen`),
  reguła ograniczona do `.kid-screen button`; e2e kid 5/5 po zmianie.
- M2 (duplicated tone rule): **wykonano** — `mockTestScoreTone` wyeksportowany
  z kid-ui, używany w obu ekranach + test jednostkowy (RED→GREEN).
- M3a (mieszanie słownictwa kid/rodzic w jednej karcie): **odrzucone/złożone**
  — pastylki celowo używają krótkich etykiet kid (spójność wizualna z omówieniem
  dziecka), liczniki per umiejętność od zawsze używały długich etykiet postępu;
  kosmetyka, brak wpływu na poprawność.
- M3b („Opanowanie: Nie sprawdzono" dublowało etykietę): **wykonano** —
  jednolity status not_assessed pomijany w szarej linii + asercja e2e.
- M4 (komenatarz pomijał insufficient_options): **wykonano** (przepisany komentarz).
- M5 (etykieta unassessed w pastylkach — odziedziczone z #35, poza tym diffem):
  **odrzucone/złożone** jako odroczone; dotyczy też widoku dziecka, osobna decyzja.

## Weryfikacja po poprawkach

- `pnpm typecheck` — 0 błędów.
- `pnpm test:unit` — 405/405 (w tym 25 w dotkniętych plikach; RED→GREEN
  dla tone, samodzielności i luk zaobserwowane).
- `pnpm build` — ✓ Compiled successfully.
- `pnpm test:integration` — 173/173 (przed poprawkami; dotknięte tylko
  contracts/kid-ui/web — po poprawkach pełny e2e).
- `playwright test mock-test-parent.spec.ts mock-test.spec.ts` — 7/7
  (UMIEM_TEST_RUN_ID=parent-fix1), w tym nowe asercje: „Poza tą porcją 12",
  brak „Opanowanie:" na wierszach przerwanych, ton z data-tone.
- Pełne e2e 67/67 — patrz runda 2 (poniżej).

## Runda 2

Zakres: `b7f5f09..97fa0fd` (oba commity), recenzent ten sam. Recenzent
niezależnie zweryfikował typecheck (0 błędów) i unit 405/405 oraz diff wiersz
po wierszu; potwierdził rozstrzygnięcia rundy 1 (w tym odrzucenie zmiany
serwerowej jako zgodne ze SPEC §19.1 i uzasadnione dla zadania bounded).

Werdykt: **Tak — gotowe do scalenia**, z dwoma warunkami przy PR:

1. pełne e2e na head — spełnione: 67/67 (UMIEM_TEST_RUN_ID=parent-final2).
2. porządki — spełnione: dziennik zacommitowany; artefakt
   `.world-parent-final2.json` usunięty przez teardown, wzorzec
   `.gitignore` poszerzony do `tests/e2e/.world*.json`.

Dodatkowe Minory z rundy 2 (nieblokujące):

- literówka „słowy" w dokumencie modułu — **poprawiona**,
- format liczników luk „Poza tą porcją: 12" (dwukropek) — **poprawione**
  + zaktualizowana asercja e2e,
- precyzja SPEC („tego samego widoku postępów" zamiast „tej samej karty")
  — **poprawione**,
- słowo z celami mieszającymi się w/poza porcją liczy się i na liście słów,
  i w agregacie luk — **odrzucone/złożone**: linia opisuje cele słowa poza
  porcją, co jest prawdziwe; liczniki per umiejętność pozostają precyzyjne.

## Wynik końcowy

Review niezależny (dedykowany subagent, GLM-5.3 — najmocniejszy dostępny,
GPT Astra nieobecny w środowisku). Dwie rundy: With fixes → Tak. Wszystkie
Critical/Important rozwiązane; Minory wykonane lub uzasadnione odrzucone
(poniżej lista odroczonych). Weryfikacja na head: typecheck 0 błędów,
unit 405/405, integration 173/173 (przed poprawkami; scope poprawek:
contracts/kid-ui/web bez serwera), build ✓, e2e 67/67.

Odroczone (Minor, bez decyzji właściciela): etykieta wyniku unassessed
w pastylkach (dziedziczone z #35, dotyczy też dziecka); mieszanie krótkich
etykiet umiejętności kid z długimi etykietami postępu w jednej karcie.
