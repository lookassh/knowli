# Responsywny układ odpowiedzi — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Wykonanie w bieżącym worktree.

**Cel:** Czytelne, zwarte odpowiedzi na telefonie i większych ekranach, bez pustych rezerw i kolumn.

**Architektura:** `ExerciseFrame` jest właścicielem miejsca na materiał i rzeczywistą stopkę. `AnswerGrid` jest jedynym właścicielem wymiarów kafelków; korzysta z rozmiaru kontenera materiału. Wybory obrazkowe i tekstowe korzystają z feedbacku w przepływie; pozostałe ćwiczenia zachowują obecne sloty formularzy. Brak zmian API, MCP, reguł domenowych i transakcji.

**Stack:** React, istniejące komponenty Mantine, CSS Modules, Playwright.

**Uzgodniony zakres:** propozycja z rozmowy zatwierdzona poleceniem „zrób to”, rozszerzona na widoki z tym samym problemem. Czytelność ma pierwszeństwo przed zerowym scrollem na niskim ekranie. Nie zmieniamy zachowania natychmiastowego wyboru i nie resetujemy zadania przy resize.

## Zadania

- [x] Dodać regresję geometrii czterech obrazków dla rozmiarów ze zrzutów i granic breakpointów; potwierdzić porażkę obecnego układu.
- [x] Wprowadzić jawny tryb feedbacku w przepływie w `ExerciseFrame`; usunąć puste sloty dla wyborów, zachować rzeczywiste akcje kartkówki. Sprawdzić obrazek→słowo, wybory tekstowe i lekcje.
- [x] Skupić wymiarowanie obrazków w `answer-controls.module.css`; usunąć duplikaty i rezerwy z `styles.css`, zachować znaczniki wyniku, etykiety dostępności i cele dotykowe.
- [x] Zaktualizować testy starego układu nakładki na nowy kontrakt: brak ruchu przed werdyktem, brak zakrycia po werdykcie, dostępność feedbacku i opcji przez scroll, proporcje i odstępy.
- [x] Uruchomić testy komponentów, typecheck, celowane E2E, build produkcyjny i regresje responsywności. Obejrzeć zrzuty. Zaktualizować kontrakt prezentacji w architekturze; raportować brak odbioru fizycznego urządzenia.

## Szczególne ryzyka

- Telefon 360×560 i okno 489×500: obrazki nie mogą skurczyć się do 48 px.
- 599/600 oraz 699/700 px szerokości: brak skoków i pustej kolumny.
- Długi feedback, tekst 200%, zoom i landscape: treść oraz przyciski osiągalne.
- Dwie, trzy i cztery opcje, obrazki i deterministyczne wizuale: spójne kwadraty.
- Zmiana rozmiaru przy oczekującej odpowiedzi nie wysyła jej ponownie i nie resetuje stanu.

## Wynik wykonania

- Regresja przed implementacją: 360×560, kafelek 54,53 px przy wymaganiu ≥112 px — FAIL zgodny ze zgłoszeniem.
- Po implementacji: 11 rozmiarów przed odpowiedzią; 2–4 ilustracje po werdykcie, zoom 200%, landscape i przejścia między rozmiarami — PASS.
- 496 testów jednostkowych (43 pliki: Kid UI i kompletność partycji E2E), typecheck oraz produkcyjny build Next.js — PASS.
- Produkcyjne E2E: wszystkie cztery kosze real (31 + 26 + 20 + 33 = 110 testów) — PASS. Pierwszy przebieg mocked wskazał cztery założenia jednoczesnej widoczności wszystkich opcji w dawnym pomniejszanym układzie; testy zaktualizowano na czytelne opcje, osiągalne przez scroll i niezakryte stopką. Cały mocked po aktualizacji: 147/147 PASS.
- Dodatkowe przypadki reading/listening/lesson_choice z długim feedbackiem, 360×500 i tekstem 200% — PASS.
- Niezależny przegląd statyczny: brak potwierdzonych P1/P2; zasugerowaną lukę dotyczącą długiego feedbacku pokryto powyższymi testami.
- Ruling: po werdykcie dopuszczamy zmianę wysokości materiału, zamiast blokować go stałą rezerwą na niewidoczny wynik. Geometria podczas oczekiwania i stan sesji pozostają zachowane.
- Brak nowych zależności, zmian API → MCP → skill i zapisów danych. Brak push/PR/wdrożenia oraz odbioru na fizycznym telefonie.