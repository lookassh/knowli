---
phase: 261022-oe2
plan: 01
subsystem: kid-ui
tags: [css, responsive, kiosk, picture_listening, layout]
status: complete
requires:
  - "packages/kid-ui/src/styles.css (stan z audytu UI 2026-10-22)"
provides:
  - "Ekran picture_listening mieści się w dostępnej wysokości viewportu 541–949 px bez scrollbara (KIOSK-01)"
  - "Rozmiar kafelka obrazka jako funkcja dostępnej wysokości (wiersze minmax(112px,1fr), height:100%)"
  - "Dwukolumnowy układ ratunkowy dla wide-landscape ≤900 px wysokości"
affects:
  - "packages/kid-ui/src/screens/LearnScreen.tsx (prezentacja picture_listening — bez zmian kodu, tylko CSS)"
tech-stack:
  added: []
  patterns:
    - "height-budget grid: łańcuch flex:1 + min-height:0 + overflow:hidden + wiersze minmax(112px, 1fr)"
key-files:
  created: []
  modified:
    - packages/kid-ui/src/styles.css
decisions:
  - "Kafelek wymiarowany z dostępnej wysokości (width:auto, height:100%, max-width min(100%,35svh)), nie z pełnego svh — fix #1 audytu."
  - "Próg układu ratunkowego podniesiony 540→900 px; szerokościowe nadpisania 35svh usunięte — fix #2 audytu."
  - "[Rule 1] align-self:stretch dla .kid-material w układzie ratunkowym — align-items:center ramki każe materiałowi przyjąć wysokość max-content, co łamało budżet wysokości w dole pasma 541–826 px."
  - "Weryfikacja geometryczna Playwright (Chromium) na 14 kształtach viewportu przed commitem — potwierdza overflow 0 px w całym paśmie audytu."
metrics:
  duration: "22 min"
  completed: "2026-10-22T16:07:23Z"
  tasks_completed: 2
  tasks_total: 2
actuals:
  tokens: 970        # chars/4 over realized diff (3879 chars, 32+/21-)
  tasks: 2
  commits: 2         # measured: git rev-list --count 12c7d55..HEAD
plan_head_before: 12c7d55148d611a4a14c8122fb22f77ad537de4f
plan_head_after: fb73fb8df3c709e318cebe508938946b6ff9d374
requirements: [KIOSK-01]
---

# Quick Task 261022-oe2: Naprawa kiosku — scrollbar na ekranie wyboru obrazka Summary

Ekran `picture_listening` dostaje budżet wysokości z dostępnego miejsca (łańcuch flex + wiersze `minmax(112px, 1fr)`), a układ ratunkowy dwukolumnowy obejmuje pasmo 541–900 px wysokości — dolny rząd obrazków nie wypada już pod linią zgięcia iframe kiosku.

## Co zostało zrobione

### Task 1: Budżet wysokości siatki obrazków (audyt fix #1) — commit 3beca75

- `.kid-material` i `.kid-material-content` dla `picture_listening` wracają do flex-containment (`flex:1; min-height:0; overflow:hidden`) zamiast `flex:none; overflow:visible`.
- `.kid-picture-options`: `flex:1 1 auto; min-height:0`; wiersze `minmax(112px, 1fr)` (minimum dotykowe) zamiast `max-content`.
- Kafelek: `width:auto; height:100%; max-width:min(100%, 35svh)` zamiast szerokości `25svh` — rozmiar płynie z dostępnej wysokości, 35svh to górna klamra wzrostu.
- Tryby zoom/very-short: jawne `height:auto` przy kafelkach 112 px (procentowa wysokość nie rozciąga kafelka przy wierszach auto).
- Komentarz przy bloku dokumentuje decyzję audytu 2026-10-22.

### Task 2: Próg układu ratunkowego 900 px (audyt fix #2) — commit fb73fb8

- Oba media queries ratunkowe (blok gridowy ramki + nadpisanie 112 px): próg `max-height` 540→900 px.
- Usunięte oba szerokościowe nadpisania kafelka `width: min(100%, 35svh)` (media landscape + wnętrze bloku ratunkowego) — jawna szerokość + jawna wysokość ignorują `aspect-ratio`.
- `height:auto` dodane do nadpisania 112 px w landscape (spójnie z zadaniem 1).
- Komentarz przy bloku ratunkowym wyjaśnia zakres progu 900 px.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `align-self: stretch` dla `.kid-material` w układzie ratunkowym**

- **Found during:** Task 2 (weryfikacja geometryczna Playwright po zadaniu 1, przed commitem zadania 2).
- **Issue:** Ramka w układie ratunkowym ma `align-items: center` — materiał przyjmuje wysokość max-content zamiast rozciągać się do wiersza `1fr`. Łańcuch budżetu wysokości przerywa się na granicy frame→material: wiersze siatki rozstrzygają się na max-content (2×min(szerokość kolumny, 35svh)), a siatka z rezerwacją wyniku (~68 px) wystaje poza kontener nauki, gdy `2×35svh+68 > H−180`, czyli w całym dole pasma ~541–826 px (np. 1440×800 → scrollbar ~10 px, 1280×541 → 48 px). Objaw BLOCKER-a z audytu utrzymyby się w większości pasma; przy ~860–880 px mieściło się przypadkiem (max-content akurat < wiersza).
- **Fix:** `align-self: stretch` w regule `.kid-material` wewnątrz media query układu ratunkowego (ten sam blok, który zadanie 2 i tak modyfikuje); wysokość materiału płynie z wiersza `1fr`, wiersze siatki dostają dostępne miejsce.
- **Files modified:** packages/kid-ui/src/styles.css
- **Commit:** fb73fb8
- **Dowód:** Pomiar Playwright/Chromium przed fixem: `learning overflow = 48 px` (1280×541) i `39 px` (1280×600); po fixie: `0 px` na wszystkich 14 kształtach testowych.

### Ograniczenia geometryczne (świadome, do potwierdzenia na kiosku)

Must-have „kafelki pozostają kwadratami" spełnione jest, gdy budżet wysokości ≤ 2×szerokość kolumny + 12 px. Wyjątki (kafelki lekko wydłużone pionowo, ale **wszystkie widoczne, bez scrollbara** — priorytetem audytu był fit):

| Kształt | Kafelek | Stan |
| --- | --- | --- |
| iframe kiosku 1920×860–880 | 250.8 × 272–282 | ALL-VISIBLE (wysokość ~9% ponad szerokość) |
| pełny ekran 1920×1010 (układ 1-kolumnowy >900 px) | 258 × 319 | ALL-VISIBLE |
| telefon portrait 360×700–744 | 158 × 184 | ALL-VISIBLE |

Wymuszenie kwadratów w tych kształtach wymagałoby przełączenia osi wymiarowania na szerokość — analiza i pomiar wykazały, że to powoduje przycinanie/scrollbar na zwykłych telefonach (np. 360×560–620), co jest gorsze niż łagodne proporcje. W całym dole pasma (541–~800 px) oraz na telefonach ≤640 px kafelki pozostają kwadratowe.

## Verification

- Bramki grep zadań 1–2 (wszystkie zgodne z polami `<done>`): `minmax(112px, 1fr)`=1, `max-content`=0, `max-width: min(100%, 35svh)`=1, `width: min(100%, 25svh)`=0, `max-height: 900px)`=2, `max-height: 540px)`=0, wierszowe `width: min(100%, 35svh)`=0.
- Parsowanie CSS przez postcss: OK (po obu zadaniach).
- Testy jednostkowe kid-ui: 28 plików, 388 testów — przechodzą (1,3 s), po każdym zadaniu i na końcu.
- Tracer gate (zadanie 1): pełne `<verify>` uruchomione ponownie po commicie — PASSED (tryb interaktywny, human_verify_mode=end-of-phase, verify automatyczny).
- **Weryfikacja geometryczna Playwright/Chromium** (poza planem, dowód poprawności): 14 kształtów viewportu; po fixie Rule 1 `overflow kontenera nauki = 0 px` w całym paśmie 541–949 px; tryby very-short (≤420 px) zachowują świadomy scroll strony z kafelkami 112×112.
- Weryfikacja na urządzeniu (iframe kiosku ~870 px, 4 opcje): do potwierdzenia przez właściciela — wg planu poza agentem.

## Zgodność z AGENTS.md

- Zmiany wyłącznie w `packages/kid-ui/src/styles.css` (prezentacyjne, bez nowych granic zaufania).
- Testy: tylko szybkie testy jednostkowe zmienianego modułu (`corepack pnpm vitest run --config vitest.unit.config.ts packages/kid-ui`); bez npm install (node_modules istniały); bez push do main.

## Known Stubs

Brak — zmiana wyłącznie CSS, bez stubów kodu.

## Threat Flags

Brak nowych powierzchni ataku poza modelem zagrożeń planu (T-261022-01 mitigowane: podłoga wierszy 112 px zachowana, tryby very-short/zoom zachowują naturalną wysokość i scroll strony — potwierdzone pomiarem; weryfikacja na kiosku u właściciela).

## Self-Check: PASSED

- packages/kid-ui/src/styles.css: FOUND (zmodyfikowany, 2 commity)
- 3beca75: FOUND (ancestor HEAD)
- fb73fb8: FOUND (HEAD)
