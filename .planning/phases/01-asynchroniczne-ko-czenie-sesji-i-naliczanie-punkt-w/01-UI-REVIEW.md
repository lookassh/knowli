# Phase 01 — UI Review

**Audited:** 2026-10-21
**Baseline:** abstract standards
**Screenshots:** not captured (localhost:8080 responded, but all three Playwright captures failed)
**Interaction captures:** off (workflow.ui_interaction_capture is false)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|---|---:|---|
| 1. Copywriting | 4/4 | Krótkie, polskie komunikaty jasno rozróżniają oczekiwanie, wynik i błąd. |
| 2. Visuals | 3/4 | Stan oczekiwania używa tej samej prezentacji co zwykły licznik podsumowania. |
| 3. Color | 3/4 | Status nie ma odrębnego tonu wizualnego, choć system kolorów ma tokeny do takiego rozróżnienia. |
| 4. Typography | 4/4 | Tekst statusu ma czytelną wielkość i jest zgodny z pozostałymi licznikami podsumowania. |
| 5. Spacing | 4/4 | Status korzysta z istniejącego układu podsumowania oraz responsywnego odstępu dla małych ekranów. |
| 6. Experience Design | 4/4 | Podsumowanie i akcje pozostają dostępne, a zmiana wyniku jest ogłaszana asystująco. |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **Nadać stanowi oczekiwania subtelne wyróżnienie wizualne** — dziecko szybciej rozpozna, że punkty nadal są liczone — dodać wariant klasy dla `already_started`, na przykład neutralną ikonę lub delikatny kolor tła zgodny z tokenami UI.
2. **Objąć zrzutem ekran podsumowania po zakończeniu sesji** — audyt nie mógł potwierdzić rzeczywistego układu na telefonie i tablecie — uruchomić fixture lub lokalny przepływ Kid UI i ponowić capture.
3. **Dodać test wizualnego wariantu stanu pending** — zmiana klasy lub ikony powinna być utrwalona w teście komponentu razem z obecnym testem `role=status`.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

Komunikat oczekiwania „Punkty z tej nauki są jeszcze liczone.” jest krótki i zrozumiały dla dziecka. Wynik oraz błąd zachowują język adekwatny do faktycznego stanu, bez obietnicy trwałego opanowania. Wybór tekstu jest w `packages/kid-ui/src/screens/SessionActivityResultView.tsx:9-13` i jest testowany w `packages/kid-ui/src/screens/reward-summary.test.tsx:80-94`.

### Pillar 2: Visuals (3/4)

**WARNING:** `SessionActivityResultView` renderuje stan oczekiwania tą samą klasą `kid-summary-counts` co naliczone punkty i pozostałe liczniki (`packages/kid-ui/src/screens/SessionActivityResultView.tsx:8`, `packages/kid-ui/src/screens/SummaryScreen.tsx:35-43`). Przy dłuższym przeglądaniu podsumowania nie ma niewerbalnego sygnału, że wynik zmieni się później. Nie blokuje to zadania, ale osobny wariant klasy lub mała dekoracyjna ikona wzmocni hierarchię.

### Pillar 3: Color (3/4)

**WARNING:** Stylesheet ma tokeny dla neutralnych i pozytywnych stanów, lecz licznik pending nie dostaje własnej klasy ani tonu (`packages/kid-ui/src/styles.css:1883-1886`). Ten sam wygląd dostają `evaluated`, `already_started` i błąd. Minimalny, dostępny wariant powinien zachować kontrast i nie opierać znaczenia wyłącznie na kolorze.

### Pillar 4: Typography (4/4)

`kid-summary-counts` używa czytelnego rozmiaru `1.15rem` i wyrównania do środka (`packages/kid-ui/src/styles.css:1883-1886`). Tekst jest umieszczony bezpośrednio pod nagłówkiem podsumowania (`packages/kid-ui/src/screens/SummaryScreen.tsx:31-34`), co zapewnia przewidywalną kolejność czytania.

### Pillar 5: Spacing (4/4)

Status wykorzystuje istniejący rytm ekranu podsumowania; układ akcji ma stały odstęp i pełną szerokość przycisków (`packages/kid-ui/src/styles.css:1914-1930`). Dla ekranów do 420 px ekran podsumowania ma mniejszy, spójny padding (`packages/kid-ui/src/styles.css:2192-2204`).

### Pillar 6: Experience Design (4/4)

Wynik jest ogłaszany przez `role="status"` i `aria-live="polite"` (`packages/kid-ui/src/screens/SessionActivityResultView.tsx:8`). Akcje „Jeszcze raz” i zmiana profilu nie są wyłączane w stanie pending, co potwierdza `packages/kid-ui/src/screens/reward-summary.test.tsx:91`. Ten przebieg realizuje podstawową decyzję fazy: punktowy wynik nie blokuje podsumowania ani dalszej nauki.

---

## Files Audited

- `packages/kid-ui/src/screens/SessionActivityResultView.tsx`
- `packages/kid-ui/src/screens/SummaryScreen.tsx`
- `packages/kid-ui/src/screens/MockTestSummaryScreen.tsx`
- `packages/kid-ui/src/screens/LessonMockTestSummaryScreen.tsx`
- `packages/kid-ui/src/screens/reward-summary.test.tsx`
- `packages/kid-ui/src/styles.css`
- `packages/kid-ui/src/KidApp.tsx`
