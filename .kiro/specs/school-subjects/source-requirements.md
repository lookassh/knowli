# Rozszerzenie SPEC.md — Nauka szkolna i trener odpowiedzi

**Status:** Propozycja nowego modułu produktu  
**Zakres:** Biologia, historia, język polski i inne przedmioty szkolne  
**Grupa docelowa:** Dzieci w wieku szkolnym, początkowo około 8–12 lat

## 1. Cel rozszerzenia

Rozbudować istniejącą aplikację do nauki angielskiego o możliwość nauki dowolnego materiału szkolnego na podstawie podręczników, zeszytów i notatek.

Nowy moduł powinien realizować dwa niezależne, ale powiązane cele:

1. Przygotowanie dziecka do sprawdzianów przez zrozumienie, zapamiętanie i samodzielne odtwarzanie najważniejszych informacji.
2. Rozwijanie umiejętności udzielania logicznych, precyzyjnych i zwięzłych odpowiedzi.

Szczególnie ważny jest drugi cel.

Aplikacja powinna wspierać dziecko, które zna materiał, ale podczas odpowiedzi rozwija liczne wątki, dodaje niepotrzebne szczegóły albo nie potrafi wybrać najważniejszych informacji.

Nie należy traktować rozwlekłej wypowiedzi automatycznie jako błędnej odpowiedzi.

## 2. Integracja z istniejącą aplikacją

Nowa funkcjonalność powinna być osobnym modułem nauki, wykorzystującym istniejące:

- Profile dzieci i przypisania materiałów.
- Parent Mode i Kid Mode.
- Historię prób.
- System adaptacyjnych powtórek.
- Terminy sprawdzianów.
- Integracje LLM, STT i TTS.
- System wersjonowania materiału i zatwierdzania treści.

Istniejący typ zestawu `vocabulary` pozostaje bez zmian.

Nowy typ zestawu: `source_material`.

Nie należy próbować modelować pytań z historii czy biologii jako par słowo–tłumaczenie. Nowy typ posiada własne pojęcia, zadania, kryteria oceny i śledzone umiejętności.

Rozszerzenie nie może zmienić dotychczasowego sposobu oceniania angielskiego słownictwa.

## 3. Tworzenie materiału do nauki

### 3.1. Dane wejściowe

Rodzic może:

- Przesłać wiele zdjęć stron podręcznika (JPG/PNG).
- Przesłać dokument PDF.
- Dodać zdjęcia notatek z zeszytu.
- Wkleić tekst.
- Określić przedmiot, temat i profil dziecka.
- Podać zakres sprawdzianu wskazany przez nauczyciela.
- Opcjonalnie ustawić datę sprawdzianu.

Aplikacja powinna obsługiwać wielostronicowe materiały i umożliwiać skorygowanie kolejności stron.

### 3.2. Analiza materiału przez AI

Proces przygotowania:

1. Odczytanie tekstu i istotnych elementów wizualnych dokumentu.
2. Wykrycie nieczytelnych lub brakujących stron.
3. Podział materiału na logiczne zagadnienia.
4. Wyodrębnienie najważniejszych faktów i definicji.
5. Przygotowanie krótkiego opracowania.
6. Wygenerowanie pytań sprawdzających zrozumienie i pamięć.
7. Przypisanie pytań do odpowiednich fragmentów materiału.
8. Walidacja kompletności i spójności wygenerowanego zestawu.
9. Przedstawienie rodzicowi szkicu do zatwierdzenia.

AI powinno rozróżniać informacje obowiązkowe, szczegóły uzupełniające i przykłady.

Nie może przedstawiać własnych domysłów jako faktów pochodzących z podręcznika.

### 3.3. Opracowanie dla dziecka

Dla każdego tematu system przygotowuje:

- Krótkie podsumowanie prostym językiem.
- Najważniejsze pojęcia i definicje.
- Fakty wymagające zapamiętania, np. daty, nazwiska, nazwy.
- Zależności przyczynowo-skutkowe, jeśli są istotne.
- Przykłady pomagające zrozumieć trudne pojęcia.
- Pytania przygotowujące do sprawdzianu.

Opracowanie ma zmniejszać ilość materiału do jednoczesnego przyswojenia, ale nie może usuwać faktów istotnych dla wskazanego zakresu sprawdzianu.

Każdy wygenerowany element powinien mieć powiązanie ze źródłem: dokumentem, stroną i odpowiednim fragmentem.

### 3.4. Zatwierdzanie

Rodzic przegląda opracowanie i pytania.

Może edytować:

- Odpowiedzi wzorcowe.
- Listy obowiązkowych informacji.
- Poziom trudności.
- Zagadnienia wymagające szczególnego przećwiczenia.
- Oczekiwaną długość odpowiedzi.

Rodzic może dodać własne informacje, np. notatki podane przez nauczyciela. Takie informacje muszą być oznaczone jako osobne źródło rodzica, a nie przypisane do podręcznika.

Dziecko nie widzi szkicu przed zatwierdzeniem.

## 4. Model pytania

Każde pytanie otwarte powinno posiadać następujące właściwości:

- Treść pytania.
- Typ pytania, np. definicja, wymienianie, wyjaśnienie przyczyny, porównanie.
- Wzorcowa odpowiedź.
- Listę wymaganych elementów odpowiedzi.
- Opcjonalną listę częstych błędów merytorycznych.
- Oczekiwany poziom szczegółowości.
- Źródła potwierdzające odpowiedź.
- Poziom trudności.
- Przypisane umiejętności.

Przykład:

**Pytanie:** Co to jest fotosynteza?

**Wymagane elementy:**
- Proces wytwarzania związków organicznych, w tym cukrów.
- Wykorzystanie wody i dwutlenku węgla.
- Wykorzystanie energii światła.

**Informacja uzupełniająca:** W trakcie fotosyntezy tlenowej uwalniany jest tlen.

**Oczekiwana forma:** Krótka definicja, najlepiej jedno zdanie.

Ocena nie powinna wymagać identycznego brzmienia jak odpowiedź wzorcowa.

## 5. Rodzaje ćwiczeń

### 5.1. Nauka pojęcia

Dziecko widzi definicję, wyjaśnienie i przykład.

Może zapoznać się z materiałem bez presji oceniania.

Sama prezentacja materiału nie jest dowodem opanowania pojęcia.

### 5.2. Samodzielna odpowiedź

System zadaje pytanie, na które dziecko odpowiada własnymi słowami.

Wspierane formy:

- Odpowiedź pisemna.
- Odpowiedź głosowa po transkrypcji przez STT.

AI ocenia treść i przekazuje krótką informację zwrotną.

### 5.3. Trzy słowa kluczowe

Przed udzieleniem odpowiedzi dziecko ma wskazać 2–3 najważniejsze pojęcia związane z pytaniem.

Następnie buduje z nich odpowiedź.

Celem jest nauczenie selekcjonowania informacji przed rozpoczęciem wypowiedzi.

Tryb wspomaga porządkowanie myśli i nie powinien być mylony z niezależnym sprawdzeniem pamięci.

### 5.4. Odpowiedz w jednym zdaniu

System zadaje pytanie wymagające krótkiej odpowiedzi.

Dziecko musi zawrzeć najważniejsze informacje bez niepotrzebnych dygresji.

Ograniczenie do jednego zdania stosujemy wyłącznie wtedy, gdy pytanie rzeczywiście pozwala na taką odpowiedź.

### 5.5. Skróć swoją odpowiedź

Dziecko najpierw odpowiada swobodnie.

AI analizuje wypowiedź i wskazuje:

- Informacje niezbędne.
- Informacje poprawne, ale zbędne.
- Informacje niezwiązane z pytaniem.
- Ewentualne braki merytoryczne.

Następnie dziecko próbuje skrócić odpowiedź, zachowując jej sens i poprawność.

Oryginalna i poprawiona odpowiedź są zapisywane osobno.

### 5.6. Próbny sprawdzian

Dziecko odpowiada na zestaw pytań bez podpowiedzi i bez wyświetlania odpowiedzi wzorcowych.

Dopiero po zakończeniu otrzymuje:

- Podsumowanie poprawności.
- Listę opanowanych zagadnień.
- Listę brakujących informacji.
- Wskazówki dotyczące precyzji odpowiedzi.
- Propozycję kolejnych powtórek.

## 6. Inteligentna ocena odpowiedzi otwartych

To najważniejsza nowa funkcjonalność.

W przeciwieństwie do oceniania pisowni angielskich słów, odpowiedzi z historii, biologii i języka polskiego wymagają analizy semantycznej przez LLM.

### 6.1. Dwa niezależne wymiary oceny

**A. Poprawność merytoryczna**

Czy dziecko:

- Zawarło wymagane informacje?
- Rozumie omawiane pojęcie?
- Nie popełniło błędu rzeczowego?
- Nie pominęło kluczowego elementu?

Możliwe wyniki:

- Poprawna.
- Częściowo poprawna.
- Niepoprawna.
- Nie można wiarygodnie ocenić.

**B. Jakość wypowiedzi**

Czy odpowiedź:

- Dotyczy bezpośrednio pytania?
- Jest logicznie uporządkowana?
- Zawiera niepotrzebne dygresje?
- Jest wystarczająco precyzyjna?
- Ma długość odpowiednią do zadania?

Możliwe poziomy:

- Zwięzła i precyzyjna.
- Poprawna, lecz z nadmiarem informacji.
- Nieuporządkowana lub odbiegająca od tematu.
- Nie można wiarygodnie ocenić.

Ocena jakości wypowiedzi nie może automatycznie obniżać oceny poprawności wiedzy.

### 6.2. Przykładowa sytuacja

Pytanie: „Dlaczego Mieszko I przyjął chrzest?”

Dziecko udziela długiej odpowiedzi, wspominając o innych wydarzeniach historycznych, ale prawidłowo podaje najważniejsze przyczyny wskazane w podręczniku.

System powinien ocenić wiedzę jako poprawną, a jednocześnie zwrócić uwagę, że znaczna część wypowiedzi nie była potrzebna.

Nie należy wymagać zapamiętania jednego, dosłownego sformułowania.

### 6.3. Zasady działania AI

LLM otrzymuje:

- Dokładne pytanie.
- Zatwierdzoną odpowiedź wzorcową.
- Wymagane elementy odpowiedzi.
- Fragmenty materiału źródłowego.
- Odpowiedź dziecka.
- Kryteria oceniania odpowiednie dla typu pytania.

LLM zwraca ustrukturyzowany wynik zawierający:

- Ocenę merytoryczną.
- Ocenę precyzji.
- Wykryte wymagane informacje.
- Brakujące elementy.
- Błędne stwierdzenia.
- Zbędne informacje.
- Krótką informację zwrotną.
- Opcjonalną podpowiedź.
- Status wiarygodności oceny.

Backend waliduje strukturę wyniku.

LLM nie może samodzielnie zmieniać kryteriów oceniania, zatwierdzonych odpowiedzi ani historii ucznia.

Oceny niepewne nie są zapisywane jako błędy ucznia.

## 7. Sposób przekazywania informacji zwrotnej

System powinien działać jak cierpliwy nauczyciel, a nie egzaminator krytykujący każdą niedoskonałość.

Informacja zwrotna powinna być krótka i konkretna.

Preferowana kolejność:

1. Wskazanie, co w odpowiedzi było poprawne.
2. Zwrócenie uwagi na jeden najważniejszy brak lub problem.
3. Poproszenie dziecka o poprawę odpowiedzi.

Przykład:

„Dobrze pamiętasz, że rośliny wykorzystują światło. Brakuje informacji, co wytwarzają. Spróbuj odpowiedzieć jeszcze raz w jednym zdaniu”.

Jeśli odpowiedź zawiera wszystkie wymagane elementy, ale jest rozwlekła:

„Wiesz to! Teraz spróbuj powiedzieć to krócej, bez dodatkowych historii”.

System nie powinien ujawniać wzorcowej odpowiedzi natychmiast po pierwszej częściowo poprawnej próbie.

Po dwóch nieudanych próbach powinien zaoferować rozwiązanie lub prostsze wyjaśnienie, zgodnie z istniejącą filozofią aplikacji.

## 8. Śledzenie postępów

Dla pytań otwartych system powinien rozróżniać:

- **Wiedzę:** znajomość faktów i pojęć.
- **Samodzielne przypominanie:** odtworzenie odpowiedzi bez wskazówek.
- **Kompletność:** uwzględnianie wymaganych elementów.
- **Precyzję:** odpowiadanie na temat, bez zbędnych dygresji.

Dodatkowe dane historyczne:

- Pierwsza odpowiedź dziecka.
- Odpowiedź po poprawieniu.
- Brakujące elementy.
- Wykryte błędne informacje.
- Użyte podpowiedzi.
- Czy potrzebne było ponowne sformułowanie odpowiedzi.
- Wersja kryteriów oceniania.
- Wynik oceny automatycznej.

Nie należy łączyć wszystkich wymiarów w jeden ogólny wynik opanowania.

Poprawiona odpowiedź po podpowiedzi jest postępem w ćwiczeniu, ale nie potwierdza samodzielnego przypomnienia.

## 9. Adaptacyjne powtórki

Algorytm dobiera kolejne zadania na podstawie konkretnych trudności.

Przykłady:

- Dziecko nie pamięta definicji → powtórka pojęcia.
- Pamięta część definicji → ćwiczenie brakującego elementu.
- Zna definicję, ale rozwleka odpowiedź → ćwiczenie skracania.
- Myli dwa pojęcia → ćwiczenie ich porównywania.
- Odpowiada samodzielnie i precyzyjnie → rzadsza powtórka po przerwie.

Ocena opanowania wymaga ponownego samodzielnego sprawdzenia po przerwie, zgodnie z istniejącymi zasadami produktu.

Sam sukces bezpośrednio po pokazaniu definicji nie potwierdza trwałego zapamiętania.

## 10. Panel rodzica

Panel powinien prezentować osobno:

- Opanowanie poszczególnych zagadnień.
- Definicje sprawiające trudność.
- Pytania z brakującymi elementami odpowiedzi.
- Powtarzające się błędy rzeczowe.
- Postęp w precyzyjnym odpowiadaniu.
- Zadania wymagające powtórki przed sprawdzianem.

Szczególnie wartościowy będzie podgląd oryginalnej i poprawionej odpowiedzi.

Przykład raportu:

**Historia — Chrzest Polski**

- Większość podstawowych informacji zapamiętana.
- 3 definicje wymagają powtórki.
- W 4 pytaniach odpowiedź była poprawna, ale zawierała zbędne informacje.
- W 2 pytaniach dziecko samodzielnie skróciło odpowiedź, zachowując sens.

Raport ma pomagać rodzicowi w wyborze ćwiczeń, a nie oceniać cechy osobowości dziecka.

## 11. Bezpieczeństwo, źródła i wiarygodność

- Pytania i odpowiedzi wzorcowe muszą być powiązane z zatwierdzonym materiałem.
- AI nie może dopowiadać faktów, których nie ma w materiale, jako informacji z podręcznika.
- Nieczytelny lub niepełny materiał wymaga uzupełnienia albo oznaczenia.
- W ocenie należy uznawać poprawne parafrazy, nie tylko dosłowny tekst.
- Nie wolno uznawać odpowiedzi za poprawną, jeśli zawiera istotny błąd rzeczowy, nawet gdy pojawiają się w niej prawidłowe słowa kluczowe.
- Niepewna transkrypcja nagrania nie może obniżać wyników dziecka.
- Surowe nagrania głosowe nie są domyślnie przechowywane.
- Brak swobodnego czatu AI z dzieckiem; model realizuje wyłącznie kontrolowane zadania edukacyjne.
- Materiały i odpowiedzi dzieci pozostają prywatne, dostępne odpowiednim profilom rodzinnym.

## 12. Proponowany zakres realizacji

### Etap 1 — Nauka z podręczników

- Import zdjęć i PDF.
- Analiza treści.
- Podsumowania i definicje.
- Generowanie pytań otwartych.
- Zatwierdzanie przez rodzica.
- Pisemne odpowiedzi dziecka.
- Ocena semantyczna odpowiedzi.
- Zapisywanie historii.

### Etap 2 — Trener precyzji

- Ćwiczenie słów kluczowych.
- Odpowiedź w jednym zdaniu.
- Skracanie własnych wypowiedzi.
- Osobna ocena wiedzy i precyzji.
- Adaptacyjne powtórki z uwzględnieniem problemów z wypowiedzią.

### Etap 3 — Rozszerzenie

- Odpowiedzi głosowe z STT.
- Próbne sprawdziany.
- Rozbudowane raporty postępów.
- Porównywanie wyników z kolejnych tygodni.
- Dalsza optymalizacja doboru ćwiczeń.

## 13. Kryteria akceptacji

**N01.** Rodzic przesyła 15 zdjęć rozdziału biologii. Aplikacja odczytuje strony i przygotowuje szkic opracowania.

**N02.** Jedna strona jest nieczytelna. System oznacza problem i nie dopowiada brakujących faktów.

**N03.** Rodzic zatwierdza wygenerowane definicje i pytania. Dopiero wtedy dziecko może rozpocząć naukę.

**N04.** Dziecko podaje poprawną definicję innymi słowami niż podręcznik. AI uznaje ją za poprawną.

**N05.** Odpowiedź zawiera tylko część wymaganych elementów. AI wskazuje brak i proponuje poprawienie odpowiedzi.

**N06.** Odpowiedź jest długa, ale poprawna. System zalicza wiedzę i osobno proponuje skrócenie wypowiedzi.

**N07.** Dziecko skraca wypowiedź, usuwając istotny element. AI wykrywa utratę wymaganej informacji.

**N08.** Dziecko używa poprawnych słów kluczowych, ale przedstawia błędną zależność między nimi. AI nie zalicza automatycznie odpowiedzi.

**N09.** Dziecko korzysta z podpowiedzi. Kolejny sukces nie jest traktowany jako niezależne potwierdzenie pamięci.

**N10.** Dziecko ponownie odpowiada na pytanie po przerwie. System uwzględnia wynik w harmonogramie powtórek.

**N11.** Rozpoznawanie odpowiedzi głosowej kończy się błędem technicznym. Wynik wiedzy pozostaje nieoceniony.

**N12.** Rodzic zmienia definicję lub wymagane elementy odpowiedzi. Nowa wersja nie zmienia historycznego znaczenia wcześniejszych prób.

**N13.** Dziecko wykonuje próbny sprawdzian. W jego trakcie nie otrzymuje podpowiedzi ani wzorcowych odpowiedzi.

**N14.** Panel rodzica oddziela trudności z wiedzą od problemów z precyzją odpowiedzi.

**N15.** Nowy moduł działa niezależnie od istniejącej nauki angielskiego i nie wpływa na dotychczasowe wyniki.

## 14. Najważniejsza zasada produktu

Aplikacja nie powinna uczyć dziecka wyłącznie odtwarzania gotowych definicji.

Powinna uczyć je rozumienia zagadnienia, wybrania najważniejszych informacji i samodzielnego sformułowania odpowiedzi odpowiedniej do zadanego pytania.

**Sukces oznacza, że dziecko wie, co chce powiedzieć, potrafi wybrać istotne informacje i przekazać je jasno — bez utraty poprawności merytorycznej.**