---
title: 'Bardziej kompaktowa lista zestawów na profilu dziecka'
type: 'feature'
created: '2026-10-19'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Karty zestawów na ekranie wyboru zestawu dziecka (`DeckScreen`) zajmują zbyt dużo miejsca w pionie (duża okładka 112px wyśrodkowana nad tytułem, gwiazdki, punkty i data sprawdzianu ułożone w osobnych wierszach), przez co na ekranie mieszczą się zaledwie 1–2 karty przed koniecznością przewijania.

**Approach:** Przeprojektowanie układu kart zestawów (`.kid-deck-card`) na zwarty układ horyzontalny:
- Zmniejszenie miniatury okładki (`.kid-deck-cover`, `.kid-visual`, `.kid-illustration`) do zwartego formatu (ok. 4.25–4.75rem / 68–76px) i umieszczenie jej po lewej stronie danych zestawu zamiast pionowo nad nimi.
- Zgrupowanie metadanych zestawu (gwiazdki opanowania, zdobyte punkty i plakietka z datą sprawdzianu) w zwartej, poziomej linii/wierszu (`.kid-deck-card__meta`) pod tytułem, z zachowaniem czytelności i wszystkich istniejących atrybutów testowych.
- Zmniejszenie nadmiarowych marginesów, paddingów oraz wysokości przycisków akcji, aby na typowym ekranie widoczne były co najmniej 3–4 zestawy jednocześnie bez utraty wygody obsługi dotykowej dla dziecka.

</frozen-after-approval>

## Implementation Notes

- Zmodyfikowano strukturę JSX w `packages/kid-ui/src/screens/DeckScreen.tsx`: wydzielono `.kid-deck-card__info` oraz `.kid-deck-card__meta` w `.kid-deck-card__details`, zachowując wszystkie `data-testid` (`kid-deck-card`, `kid-deck-title`, `kid-deck-stars`, `kid-deck-reward-points`, `kid-badge`, `kid-deck`, `kid-mock-start`, `kid-end-active-session`).
- Dodano dostępny dla czytników ekranowych prefiks `<span className="kid-visually-hidden">{deck.title}: </span>` do przycisków pomocniczych kartkówki i zakończenia sesji.
- Zaktualizowano style w `packages/kid-ui/src/styles.css`:
  - Miniatura okładki/ilustracji/wizualizacji (`.kid-deck-cover`, `.kid-visual`, `.kid-illustration`, `.kid-visual-number`): zwarty rozmiar 4.25rem (68px) z `aspect-ratio: 1 / 1`, `object-fit: cover`, usunięciem ramki domyślnej dla `.kid-illustration`.
  - Wiersz metadanych `.kid-deck-card__meta`: `display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;`.
  - Plakietka daty `.kid-badge`: `white-space: nowrap; flex-shrink: 0;` zapobiegające przełamaniu daty sprawdzianu.
  - Przyciski akcji `.kid-deck-card__actions`: min-height 44px, pełna szerokość na smartfonie, na desktopie zwarta kolumna boczna o elastycznej szerokości.
  - Zmniejszono padding karty do 12px 14px (mobile) / 12px 18px (desktop), co zmniejszyło wysokość pojedynczej karty o ponad 60% (z ~260–320px do ~90–120px).

## Review Triage Log

- `medium` -- Niespójność stylów miniatury `.kid-deck-cover` względem `.kid-illustration` (ramka i box-sizing powodowały inny rozmiar): poprawiono przez `box-sizing: border-box`, `border: 0`, `object-fit: cover` i `background: transparent`.
- `medium` -- Sztywna siatka `minmax(130px, 1fr)` na mobile wymuszająca łamanie dwuwyrazowych etykiet („Próbna kartkówka”): zastąpiono układem pionowym o pełnej szerokości przycisków na mobile.
- `low` -- Sztywny limit `max-width: 220px` kontenera akcji na desktopie: zastąpiono `width: auto` przy zachowaniu minimalnej szerokości.
- `low` -- Układ przycisków akcji: dostosowano do ergonomii dotykowej (pełna szerokość na mobile, boczna kolumna na desktopie).
- `medium` -- Brak ukrytego kontekstu dostępności w przyciskach pomocniczych kartkówki i zakończenia sesji: dodano ukryty prefiks z tytułem zestawu.
- `medium` -- Brak `white-space: nowrap` i `flex-shrink: 0` na plakietce sprawdzianu: dodano, zabezpieczając przed przełamaniem daty w małym chipie.
- `false` -- Brak rezerwy przestrzennej / pustego placeholderu dla kart bez okładki: odrzucono; w Knowli każdy zestaw ma okładkę lub wizualizację, a gdyby jej brakowało, treść naturalnie zajmuje całą dostępną szerokość bez marnowania miejsca pustym boksem.
- `false` -- Niejednolite zachowanie `align-items: center` przy wieloliniowym tytule: odrzucono; wyśrodkowanie w pionie harmonijnie komponuje miniaturę 68px z 2 wierszami tekstu o łącznej wysokości ~50px.
- `low` -- Brak jawnego `text-align: left` w `.kid-deck-card .kid-hint`: dodano `text-align: left`, nadpisując globalny `text-align: center`.
- `low` -- Brak `aspect-ratio: 1 / 1` na obrazku okładki: dodano `aspect-ratio: 1 / 1` zapobiegające layout shift.
