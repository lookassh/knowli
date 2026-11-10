# Pomiar bazowy: odpowiedzi mówione w ocenie gradera szkolnego

**Reguła: brak dowodu potrzeby story 2 na przypadkach syntetycznych.** W trzech przebiegach wszystkie 12 przypadków mówionych (10 liczonych w regule, 2 sporne poza nią) miało zgodną wiedzę i precyzję, żaden werdykt nie został odrzucony przez walidację i żaden nie wywołał niepotrzebnego skracania. Skrypt wypisał „REGUŁA: story 2 niepotrzebne”.

To nie jest weryfikacja dyktowania: przypadki są napisane ręcznie, z interpunkcją i wielkimi literami, do około 170 znaków, na czterech tematach.

- Data: 2026-11-10
- Commit: ac5d4afa
- Polecenie: `corepack pnpm eval:school-grader -- --runs=3` (117 wywołań)
- Model i wersja promptu: `google/gemini-3.8-flash`, `school-grader-v3`

Uwagi stałe:

- Etykiety przypadków mówionych to oczekiwanie docelowe właściciela, nie prawda obiektywna.
- Nie zweryfikowano, czy rozpoznawanie mowy zapisuje „yyy”; przypadki są napisane ręcznie, nie pochodzą z prawdziwego rozpoznawania.
- Nie zmierzono: prawdziwych transkryptów głosu dziecka, wypowiedzi długich, bez interpunkcji, z przekręconym terminem kluczowym ani mowy poprawionej ręcznie (wtedy forma jednego zdania jest liczona i może wywołać skracanie bez zaznaczenia — zakres CAP-5).
- Trzy przebiegi przy temperaturze 0 są mocno skorelowane; 0 błędów na 10 przypadkach nie wyklucza błędów rzędu kilkunastu procent.
- Bramka zestawu liczy tylko przypadki pisane. W tym pomiarze nie została spełniona z powodu przypadków pisanych (G05 odrzucony przez walidację w przebiegu 1, fałszywe pomylenie w G06, wiedza G27 w przebiegu 3). Ta gałąź nie zmienia promptu ani kodu oceny, więc to stan zastany.
- Odrzucenie G05 to dla dziecka „Nie udało się ocenić” (1 na 117 wywołań, na odpowiedzi pisanej). Przyczyna jest nieznana, bo skrypt wypisuje surowy werdykt tylko dla przypadków mówionych. Wzmacnia to priorytet story 3 (na pewno CAP-4; CAP-3 tylko jeśli przyczyną był fragment).

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

# Pomiar po zmianie promptu (story 2)

**Reguła: mowa bez stabilnych błędów.** W trzech przebiegach wszystkie 16 przypadków mówionych (12 dotychczasowych, w tym 2 sporne, i 4 nowe H01–H04) miało zgodną wiedzę, precyzję, brakujące elementy i oczekiwany fragment nie na temat (S06); żaden werdykt nie został odrzucony przez walidację i żaden nie wywołał niepotrzebnego skracania. Przypadki częściowe i błędne (S09, S10, H02, H03, H04) nie zostały zawyżone.

- Data: 2026-11-10
- Commit: 4c7aa62f
- Polecenie: `corepack pnpm eval:school-grader -- --runs=3` (129 wywołań)
- Model i wersje promptu: `google/gemini-3.8-flash`, `school-grader-v3` (pisane, bez zmian), `school-grader-v3-speech` (mówione)

Jak czytać:

- Pomiar bazowy też nie miał błędów mowy, więc ten wynik pokazuje brak regresji, nie poprawę.
- Bramka przypadków pisanych nadal nie jest spełniona z tych samych powodów co w pomiarze bazowym (G05 — brakujące elementy, G06 — fałszywe pomylenie w jednym przebiegu, G27 — wiedza). Prompt pisany się nie zmienił; nowych porażek pisanych nie ma, a odrzucenia G05 z pomiaru bazowego tym razem nie było. AC-08 w brzmieniu „bramka przechodzi” pozostaje więc niespełnione z powodów zastanych.
- Przypadki H01–H04 były w tym przebiegu użyte pierwszy raz; po jakiejkolwiek zmianie promptu przestają być „nieużyte”.
- Uwagi stałe z pomiaru bazowego obowiązują: przypadki są napisane ręcznie, nie pochodzą z rozpoznawania mowy dziecka.

## Wyjście skryptu

```
arm=real model=google/gemini-3.8-flash promptVersion=school-grader-v3 promptVersionMowa=school-grader-v3-speech
przebieg=1/3
przypadki=27 wiedzaZgodna=27 (100%) precyzjaZgodna=26 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=5/5 falszywePomylenie=1/22 kategorieFragmentow=2/2
pisane: przypadki=27 wiedzaZgodna=27 precyzjaZgodna=26 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione: przypadki=12 wiedzaZgodna=12 precyzjaZgodna=12 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione-nowe: przypadki=4 wiedzaZgodna=4 precyzjaZgodna=4 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
 - G06 (istotny błąd rzeczowy): fałszywe pomylenie [{"said":"Fotosynteza","meant":"Oddychanie komórkowe"}]
przebieg=2/3
przypadki=27 wiedzaZgodna=26 (96%) precyzjaZgodna=26 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=5/5 falszywePomylenie=0/22 kategorieFragmentow=2/2
pisane: przypadki=27 wiedzaZgodna=26 precyzjaZgodna=26 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione: przypadki=12 wiedzaZgodna=12 precyzjaZgodna=12 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione-nowe: przypadki=4 wiedzaZgodna=4 precyzjaZgodna=4 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
 - G27 (pomylenie pojęć przy komplecie elementów): wiedza incorrect ≠ partial
przebieg=3/3
przypadki=27 wiedzaZgodna=26 (96%) precyzjaZgodna=25 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=5/5 falszywePomylenie=0/22 kategorieFragmentow=2/2
pisane: przypadki=27 wiedzaZgodna=26 precyzjaZgodna=25 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione: przypadki=12 wiedzaZgodna=12 precyzjaZgodna=12 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
mówione-nowe: przypadki=4 wiedzaZgodna=4 precyzjaZgodna=4 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
 - G27 (pomylenie pojęć przy komplecie elementów): wiedza incorrect ≠ partial
REGUŁA: mowa bez stabilnych błędów
BRAMKA: NIE SPEŁNIONA
```
