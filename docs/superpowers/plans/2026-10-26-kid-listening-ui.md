# Czytelność odpowiedzi i odsłuch w nagłówku

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Zrealizować zaakceptowane w rozmowie poprawki Kid UI.

**Architecture:** Wspólny ExerciseInstruction w ExerciseFrame z opcjonalnym odsłuchem pytania. Istniejące IconActionButton, AnswerGrid i naturalny flow panelu wyboru, bez nowych zależności, pomiarów viewportu ani zmian API/transakcji.

**Tech Stack:** React, Mantine, CSS Modules, Vitest, Playwright.

**Spec:** Uzgodnienia w rozmowie: czytelna pełna odpowiedź bez wewnętrznego scrolla, brak neutralnej ramki obrazków, jeden działający odsłuch przy instrukcji; elastyczny układ zamiast wymiarów dopasowanych do zrzutów.

## Global Constraints
- Zachować focus klawiatury, skróty i obsługę busy oraz dotyk ≥48 px.
- Lekcje pozostają bez audio; GuidanceButton odtwarza instrukcje UI, a odsłuch pytania dotychczasowy handler kontrolera.
- Wykorzystać bieżący izolowany worktree; bez PR/pusha/scalania.

## Review Focus
- Długi tekst i 200%: brak obcięcia i wewnętrznego scrolla odpowiedzi.
- Mała wysokość: opcje i akcje osiągalne, bez poziomego przepełnienia.
- Oczekiwanie na ocenę: neutralność i blokada kolejnych odpowiedzi.
- Klawiatura: focus i odtwarzanie bez podwójnego wywołania.
- Ramki wyniku pozostają widoczne przy neutralnych obrazkach bez ramki.

### Task 1: Nagłówek z odsłuchem
- [x] Dodać test komponentu ExerciseInstruction: akcja, busy, ref, brak dekoracyjnej ikony przy akcji oraz wariant bez audio.
- [x] Potwierdzić RED, wdrożyć komponent i slot audio w ExerciseFrame, przenieść odsłuch z ListeningView i PictureListeningView.
- [x] Sprawdzić testy komponentów i klawiatury.

### Task 2: Czytelność i responsywność
- [x] Rozszerzyć istniejące specy geometrii o nagłówek, neutralne ramki i długą odpowiedź bez osobnego tła/scrolla. Potwierdzić RED.
- [x] Usunąć ograniczenia wysokości kompaktowego feedbacku i jego osobne tło, zachować naturalny wzrost oraz istniejące przewijanie ramy przy zoomie.
- [x] Usunąć kolor neutralnego obramowania wyłącznie wizualnych opcji; zachować focus, pending i wynik.
- [x] Zaktualizować dokumentację architektury i uruchomić unit, typecheck oraz testy geometrii na buildzie produkcyjnym.
