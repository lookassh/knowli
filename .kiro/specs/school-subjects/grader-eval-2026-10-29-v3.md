# Ewaluacja gradera szkolnego v3 — przebieg bramki (2026-10-29)

Dowód przebiegu bramki jakości Etapu 6 (design §9.1) na złotym zestawie
`grader-golden-set.json` w wersji 2: 26 przypadków, 6 pytań, wyłącznie
fikcyjne odpowiedzi. Nowe przypadki G21–G26: trzy pomylenia pojęć
(południk/równik/równoleżnik, wysokość względna/bezwzględna), kontrola bez
pomylenia, dygresja nie na temat i informacja poprawna, ale zbędna.

- Komenda: `corepack pnpm eval:school-grader`
- Model: `google/gemini-3.8-flash`, `UMIEM_GRADER_REASONING=low` (konfiguracja
  głównego `.env`, podana przez zmienne środowiskowe)
- Wersja promptu: `school-grader-v3`
- Data: 2026-10-29, dwa przebiegi z identycznym wynikiem

Wyjście (oba przebiegi):

```
arm=real model=google/gemini-3.8-flash promptVersion=school-grader-v3
przypadki=26 wiedzaZgodna=26 (100%) precyzjaZgodna=25 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=3/3 falszywePomylenie=0 kategorieFragmentow=2/2
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
BRAMKA: OK
```

Wnioski:

- Bramka spełniona: wiedza 100% (próg 90%), brakujące elementy 95% (próg 90%),
  zero werdyktów odrzuconych przez walidator v3, pomylenie pojęć wykryte
  w 3/3 przypadków (próg 80%) i nigdy ocenione jako `correct`.
- Zero fałszywych pomyleń w przypadkach bez pomylenia (w tym G24 — poprawna
  parafraza tego samego pojęcia).
- Kategorie fragmentów (raportowane, nie bramkują): dygresja trafiła do
  `offTopicFragments`, informacja o chlorofilu do `redundantFragments`.
- Jedyna rozbieżność (G05) jak w ewaluacji v2: przy błędnej zależności model
  uznaje za brakujący także trzeci element — wiedza i tak `incorrect`.
- Zestaw jest mały (3 przypadki pomylenia); prawdziwą skuteczność pokaże
  pilotaż z dzieckiem.
