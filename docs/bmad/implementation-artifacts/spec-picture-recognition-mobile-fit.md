---
title: 'picture_recognition mieści się na małym telefonie bez przewijania'
type: 'bugfix'
created: '2026-10-19'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Na telefonach klasy Galaxy S10e (widok ~360×740–770 CSS px) ćwiczenie `picture_recognition` nie mieści się na ekranie: ilustracja (do 220px wysokości), polski podpis i 2–4 przyciski słów (min-height 64px każdy) plus rezerwacje layoutu (feedback 40px, pusty slot akcji 52px, pusty slot secondary 52px) sumują się do ~784px, więc `.kid-material-content` przewija, a dolna odpowiedź jest ścięta i wymaga scrolla, żeby ją zobaczyć i wcisnąć. Redukcja przycisków do 48px włącza się dopiero przy wysokości viewportu ≤700px (`data-viewport-short`), więc S10e wpada w lukę między 700 a 800 px.

**Approach:** Dedykowane reguły CSS `[data-prompt-kind="picture_recognition"]` w `packages/kid-ui/src/styles.css` według istniejącego wzorca `picture_listening` (który rozwiązano identycznie): ukrycie pustego `.kid-exercise-secondary` (`display: none`), niższy cap ilustracji (ok. 22svh), `min-height` 48px przycisków opcji w tym ćwiczeniu (poziom już używany w trybie viewport-short) i ciaśniejsze odstępy treści. Regresja w nowym specu e2e z viewportami 360×740 (S10e), 360×640, 360×800, 390×844 i 768×1024 oraz asercjami braku przewijania w stanie odpowiadania i w feedbackzie.

</frozen-after-approval>

## Implementation Notes

- Ślad: `packages/kid-ui/src/styles.css` (reguły `[data-prompt-kind="picture_recognition"]`), nowy `tests/e2e/picture-recognition-layout.spec.ts`, ten spec. Bez zmian TS/DTO.
- Decyzje: przyciski opcji 48px (minimum platformowe dotykowe, ten sam poziom co tryb `data-viewport-short`); ilustracja `width: min(46vw, 200px)`, `height: min(21svh, 190px)`; ukrycie pustego `.kid-exercise-secondary` jak przy `picture_listening`.
- Niespodzianka: pierwsza wersja (22svh, odstępy 10/8) zostawiała 4px przepełnienia z 4 opcjami na 360×740 (scrollHeight 433 > clientHeight 429) — wykrył to dopiero nowy test; dociśnięto odstępy (opcje 10→8, prompt 8→6) i cap do 21svh.
- Po review (Blind Hunter): reguły kompaktowe owinięte w `@media (max-height: 800px)`, więc ekrany ≥844px (390×844, 768×1024) zachowują pełny rozmiar bazowy — testy potwierdzają brak przewijania również na bazie; `display:none` secondary zostaje bezwarunkowe (slot w tym widoku zawsze pusty), komentarz CSS dokumentuje założenie. Doprecyzowanie opisu z Intent: próg 700px realizują równolegle dwa mechanizmy — atrybut JS `data-viewport-short` oraz czysty CSS `@media (max-height: 700px)`; wniosek o luce S10e (700–800px) pozostaje ten sam.
- Weryfikacja: pełny suite e2e po pierwszej iteracji 203 passed + 1 failed (test 4-opcyjny przed dociśnięciem); po poprawkach nowy spec 5/5 (w tym feedback z 3 i 4 opcjami) oraz sąsiednie `picture-recognition` + `picture-vocabulary` + `kid-ui-layout` + `picture-choice-layout` 64 passed.

## Review Triage Log

- Reguły działały bezwarunkowo także na dużych ekranach (degradacja tabletów) — **medium, patch**: owinięto w `@media (max-height: 800px)`; potwierdzone testami (390×844 i 768×1024 przechodzą asercje bez scrolla na layoutcie bazowym).
- Test 4-opcyjny bez asercji `rootScrollHeight`/`documentScrollHeight`; `toBeInViewport` akceptuje częściową widoczność — **medium, patch**: dodano pełne asercje geometrii dokumentu i korzenia.
- Wariant 4 opcje + feedback nietestowany, a wiersz z `.kid-option-audio` (56px) rośnie o ~8px względem stanu odpowiadania — **medium, patch**: test feedbacku sparametryzowany na 3 i 4 opcje, przechodzi.
- Ilustracja i podpis bez asercji `insideContent` (`.kid-material` ma `overflow:hidden`, więc „w viewport" nie dowodzi braku przycięcia) — **medium, patch**: `inside()` obejmuje też `kid-illustration` i `kid-picture-caption`.
- `display:none` na secondary to pułapka, gdyby widok zyskał `secondaryActions` — **low, patch (komentarz)**: założenie udokumentowane w CSS.
- Domyślny viewport w helperze `openRecognition` — **low, patch**: parametr obowiązkowy, każdy test przekazuje jawnie.
- Wariant 2-opcyjny nietestowany — **low, odrzucone**: ścisły podzbiór przypadku 3-opcyjnego (mniej przycisków, ten sam obrazek).
- Brak testu trybu `data-zoomed` — **low, odrzucone**: generyczna maszyneria zoomu testowana w `picture-choice-layout.spec.ts`; zmiana nie wprowadza niczego specyficznego dla zoomu.
- Brak przejścia dark-mode — **low, odrzucone**: zmiana dotyczy tylko wysokości/odstępów, kolory feedbacku bez zmian.
- Nieaktualny frontmatter specu — **false**: status `done` następuje w kroku Finalize po klasyfikacji review (zgodnie z workflow).
- Opis mechanizmu redukcji nie wymienia równoległego `@media (max-height: 700px)` — **low, doprecyzowano w Implementation Notes** (blok Intent jest zamrożony, wniosek niezmieniony).
