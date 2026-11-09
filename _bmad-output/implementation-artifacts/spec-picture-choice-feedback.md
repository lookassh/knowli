---
title: 'Responsywna siatka i wyraźny wynik wyboru obrazka'
type: 'feature'
created: '2026-10-17'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/SPEC.md'
  - '{project-root}/docs/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Na ekranie „Posłuchaj i wybierz” ilustracje nie wykorzystują szerokości telefonu, a cienka obwódka i mały symbol nie pokazują czytelnie, która odpowiedź dziecka była błędna i która została ujawniona jako poprawna.

**Approach:** Zwiększyć obrazkową siatkę proporcjonalnie do dostępnej szerokości, zachowując kwadratowy kafelek i pełną ilustrację. Wprowadzić wyraźne, kontrastowe obrysy i znaki ✓/× na osobnych tłach, przy bliskim feedbacku; poprawny wybór dziecka i ujawnione rozwiązanie pozostają odróżnialne.

</frozen-after-approval>

## Implementation Notes

- Wybrany kierunek UX: wariant A w `_bmad-output/planning-artifacts/ux-designs/ux-knowli-2026-10-17/`.
- Zmiana ograniczona do obrazu i wyniku ćwiczenia `picture_listening`; bez zmian API, ocen, historii, ujawnień, pozostałych ćwiczeń lub globalnych kontrolek sesji.
- Baseline `node_modules/.bin/vitest.CMD run packages/kid-ui/src/exercises/option-outcome.test.ts`: PASS, 8 testów.
- `PictureListeningView.tsx` renderuje jawne, dostępnie opisane znaki wyniku; pozostaje zachowany feedback serwera i dotychczasowa decyzja o kolorach.
- `styles.css` skaluje siatkę do szerokości kafelka, ustawia wynik i akcję bezpośrednio pod nią oraz dodaje układ boczny dla szerokiego, niskiego viewportu. Awaryjny przepływ dla zoomu pozostaje.
- Dodano katalog komunikatów dostępności dla odpowiedzi obrazkowych i rozszerzono Playwright o geometrię telefonu/desktopu, bliskość wyniku, nazwy dostępne i kontrast znaczników.
- Wynik ćwiczenia ma stałą rezerwę wysokości, a szeroki, niski viewport używa dwóch kolumn z ograniczeniem rozmiaru kafelków dla zoomu i bardzo krótkiego widoku.
- Weryfikacja końcowa: testy jednostkowe 12/12, testy E2E ćwiczeń obrazkowych 15/15, `corepack pnpm typecheck`, `corepack pnpm build` i `git diff --check` PASS.

## Review Triage Log

- Naprawiono: stała rezerwa feedbacku, która zapobiega przesunięciu ilustracji przy zmianie wysokości wyniku; test E2E pilnuje sąsiedztwa wyniku i akcji.
- Naprawiono: reguła landscape nadpisywała limit 112 px dla zoomu i bardzo niskiego viewportu; kompaktowa reguła jest stosowana po układzie landscape.
- Naprawiono: asercje E2E sprawdzały tylko maksymalną przerwę i dopuszczały nakładanie; dodano dolną granicę odstępu.
- Naprawiono: brak testu szerokiego, niskiego landscape; dodano przypadek 844×390 sprawdzający osobne kolumny po błędnej odpowiedzi i ponowieniu.
- Naprawiono: zduplikowane klucze geometrii w teście powodowały TS1117.
- Naprawiono: fixture testu landscape kończyła się poprawną odpowiedzią zamiast ponowienia; teraz używa kolejki `incorrect/issued` → `great/completed`.
- Reviewer nie zgłosił dalszych konkretnych problemów po follow-up.
