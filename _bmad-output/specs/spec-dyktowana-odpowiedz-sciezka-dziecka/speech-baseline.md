# Pomiar bazowy: odpowiedzi mówione w ocenie gradera szkolnego

**Reguła: story 2 niepotrzebne.** W trzech przebiegach wszystkie 12 przypadków mówionych miało zgodną wiedzę i precyzję, żaden werdykt nie został odrzucony przez walidację i żaden nie wywołał niepotrzebnego skracania.

- Data: 2026-11-10
- Commit: ac5d4afa
- Polecenie: `corepack pnpm eval:school-grader -- --runs=3` (117 wywołań)
- Model i wersja promptu: w pierwszym wierszu wyjścia

Uwagi stałe:

- Etykiety przypadków mówionych to oczekiwanie docelowe właściciela, nie prawda obiektywna.
- Nie zweryfikowano, czy rozpoznawanie mowy zapisuje „yyy”; przypadki są napisane ręcznie, nie pochodzą z prawdziwego rozpoznawania.
- Bramka zestawu liczy tylko przypadki pisane. W tym pomiarze nie została spełniona z powodu przypadków pisanych (G05 odrzucony przez walidację w przebiegu 1, fałszywe pomylenie w G06, wiedza G27 w przebiegu 3). Ta gałąź nie zmienia promptu ani kodu oceny, więc to stan zastany.

## Wyjście skryptu

```
arm=real model=google/gemini-3.8-flash promptVersion=school-grader-v3
przebieg=1/3
przypadki=27 wiedzaZgodna=26 (96%) precyzjaZgodna=25 brakujaceElementyZgodne=19/19 formaZgodna=2/2 odrzucone=1 pomylenieWykryte=5/5 falszywePomylenie=1/21 kategorieFragmentow=2/2
pisane: przypadki=27 wiedzaZgodna=26 precyzjaZgodna=25 odrzuconeWalidator=1 bladDostawcy=0 niepotrzebneSkracanie=0
mówione: przypadki=12 wiedzaZgodna=12 precyzjaZgodna=12 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
 - G05 (błędna zależność mimo słów kluczowych) [TWARDA]: werdykt odrzucony przez walidator (oczekiwano wiedzy incorrect)
 - G06 (istotny błąd rzeczowy): fałszywe pomylenie [{"said":"Fotosynteza","meant":"oddychanie komórkowe"}]
przebieg=2/3
przypadki=27 wiedzaZgodna=27 (100%) precyzjaZgodna=26 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=5/5 falszywePomylenie=0/22 kategorieFragmentow=2/2
pisane: przypadki=27 wiedzaZgodna=27 precyzjaZgodna=26 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione: przypadki=12 wiedzaZgodna=12 precyzjaZgodna=12 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
przebieg=3/3
przypadki=27 wiedzaZgodna=26 (96%) precyzjaZgodna=26 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=5/5 falszywePomylenie=0/22 kategorieFragmentow=2/2
pisane: przypadki=27 wiedzaZgodna=26 precyzjaZgodna=26 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione: przypadki=12 wiedzaZgodna=12 precyzjaZgodna=12 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
 - G27 (pomylenie pojęć przy komplecie elementów): wiedza incorrect ≠ partial
REGUŁA: story 2 niepotrzebne
BRAMKA: NIE SPEŁNIONA
```
