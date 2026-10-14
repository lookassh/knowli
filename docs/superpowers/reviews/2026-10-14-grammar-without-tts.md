# Niezależne review — gramatyka bez TTS

Recenzent: dedykowany agent `gpt-6.1-sol`, reasoning `xhigh`, read-only. Baza całego zakresu: `e079c6cdcb309b61d078e03a35f80cf165c7abbe`; review obejmowało cały niezacommitowany diff oraz nowe regresje i dziennik. Raport wcześniejszego audytu generowania lekcji był poza zakresem.

Wymagania: brak głośnika, nowych zasobów i zleceń audio odpowiedzi oraz wymogu TTS przy publikacji gramatyki. Uwzględnienie istniejących lekcji i wznowionych zadań. Zachowanie słówek, gotowych nagrań i historii. Bez nowego publicznego DTO ani migracji; MCP `learning-overview` i skill Hermesa wykluczają lekcje.

Review Focus: granice przedmiotu, materializacja i wznowienie, autoryzacja odsłuchu przed ekspozycjami, publikacja, stare kolejki TTS, współdzielone zasoby słówek, lease i blokady, zachowanie historii, znaczące testy i zgodność dokumentacji.

Important znalezione i rozwiązane: dwa workery z początkową migawką pending mogły przywrócić asset już anulowany jako failed. Poprzedni CAS lease dopuszczał każdy stan poza ready. Techniczna weryfikacja potwierdziła problem; deterministyczny test synchronizujący dwa rzeczywiste SELECT-y PostgreSQL wykazał RED: jedna niepożądana synteza. Minimalna poprawka wymaga state=pending przy przejęciu. GREEN: brak syntezy, asset=failed, run=superseded. Recenzent odczytał RED/GREEN i ponownie sprawdził poprawiony diff.

Końcowy wynik niezależnego review: **0 Critical, 0 Important, 0 Minor pozostałych.** Kod zaakceptowany do PR po zakończeniu ponownej weryfikacji po poprawce.

Przypadki rozważone i pozostawione poza oceną:

- Gotowe audio pod znanym immutable URL pozostaje zachowane; usunięcie plików i zmiana ogólnego endpointu mediów nie należą do zatwierdzonego zakresu.
- Osierocone zlecenia bez powiązań zachowują dotychczasowy lifecycle; nie można przypisać ich wyłącznie do wyłączonego przedmiotu.
- Żądań już wysłanych do zewnętrznego providera nie można cofnąć.
- Review kodu i testy lokalne nie potwierdzają wdrożenia produkcyjnego.

Dowody odczytane przez recenzenta: unit 976/976, integracja 351/351, E2E 15/15, build i typecheck PASS przed poprawką; po poprawce grammar+generation 16/16 i aktualny typecheck PASS. Końcowe wyniki ponownej pełnej weryfikacji są w `docs/superpowers/progress/2026-10-14-grammar-without-tts.md`.
