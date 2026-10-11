# Redesign Kid UI — dziennik planowania

## Zakres tej pracy

Wyłącznie specyfikacja zaakceptowanego wyglądu i plan wdrożenia. Brak implementacji produktu, testów RED/GREEN aplikacji i odbioru fizycznego S25 w tej pracy.

## Uzgodnienia

- [x] Właściciel zatwierdził Skupienie, niebieski kolor, ikonę głośnika, czytelny sukces, obrazy/symbole wyłącznie tam, gdzie wspiera je kontrakt.
- [x] Właściciel zatwierdził instrukcję jako ikonę i tekst bez tła/ramki, oddzieloną od materiału.
- [x] Właściciel wybrał Karty zestawów oraz jawnie polecił `superpowers:writing-plans`.
- [x] Zakres obejmuje wszystkie osiem typów zadań i ekran wyboru zestawu, bez zmian reguł nauki.
- [ ] Właściciel przeczytał i zatwierdził zapisany plan/spec przed implementacją.

## Checklist workflow planowania

- [x] `using-superpowers` i `brainstorming` wykonane w poprzednich etapach rozmowy: ocena, warianty, makiety, iteracje i wybór właściciela.
- [x] Odczyt aktualnego `writing-plans/SKILL.md`; rozpoznanie współdzielonych elementów, sygnatur i testów.
- [x] Git: lokalny i zdalny main na `3efdc168181d1922cadcf8c0042dbdb548d6ba7b` (#40).
- [x] Odczyt zakresu docs/SPEC, architecture, schema, folder-structure, implementation-plan oraz aktualnych ekranów, kontraktów i konfiguracji testów.
- [x] Uwzględniono profilowy tryb nagrywania (#40); stare makiety nie są źródłem zachowania gestu ani API.
- [x] Spec i plan zapisano w standardowych katalogach Superpowers.
- [x] Self-review: pokrycie spec, wykonalność kroków, sygnatury, Review Focus, proporcja. Doprecyzowano typ fixture, route responses, wiążące asercje viewportu i pełne polecenia pnpm.
- [x] Niezależne review dokumentów przed PR i obsługa uwag; szczegóły w `../reviews/2026-10-11-kid-ui-redesign-plan.md`.
- [x] Weryfikacja treści/odnośników i `git diff --check`; ponowna kontrola przed commitem.
- [ ] Commit tylko dokumentacji, push gałęzi `docs/kid-ui-redesign-plan`, PR do main i załączenie do zadania.

## Izolacja i dostosowania

Planowanie wykonano w istniejącym checkoutcie, na osobnej gałęzi dokumentacji; nie tworzono worktree, ponieważ nie rozpoczęto implementacji ani wykonania planu. `writing-plans` wymaga setupu izolacji w czasie wykonania, a doc-only wyjątek AGENTS nie wymaga sztucznego RED ani uruchamiania aplikacji. `using-git-worktrees` i baseline aplikacji są krokami przyszłego implementera, nie są tutaj deklarowane jako wykonane.

Niezwiązane, istniejące untracked: `.codex-remote-attachments/`, `.zcodeignore`, `mock-summary-screenshot.png`, `work/`. Pozostają poza commitem. Referencje makiet w katalogu wizualizacji są pomocnicze; wymagania zapisano przenośnie w spec, bez zależności od lokalnego pliku.

Właściciel jawnie zlecił skill writing-plans po zatwierdzeniu dwóch kierunków. Zapis spec odtwarza te decyzje; nie prosimy o ponowne zatwierdzanie tych samych makiet. Zapisane dokumenty nadal wymagają przeczytania przed implementacją. Domyślne wykonanie inline pochodzi z AGENTS; delegacja implementacji nie została autoryzowana.

## Sprawdzenia i review

- `git ls-remote origin refs/heads/main`: baza zgodna z lokalnym `3efdc168181d1922cadcf8c0042dbdb548d6ba7b`.
- Sprawdzono zainstalowane typy Next: `viewportFit` oraz `interactiveWidget: resizes-content` występują w `next/dist/lib/metadata/types/extra-types.d.ts`.
- Sprawdzono istnienie wskazanych aktualnych ekranów, plików testów i skryptów package.json; nowe pliki są oznaczone jako planowane.
- `git diff --check` i `git diff --cached --check`: exit 0 po pierwszej wersji i uzupełnieniu self-review.
- Testy aplikacji, build i test urządzenia nie były uruchamiane: zakres tego PR to dokumentacja.
- Niezależny review: dedykowany `gpt-6.1-sol`, jawnie `xhigh`, bez GPT Astra, read-only; zakres wszystkich trzech dokumentów i późniejszego niezacommitowanego uzupełnienia planu. Po poprawkach Critical 0/Important 0; poprawiono także Minor dotyczące fixtures, testu modalnego i filtra testu zoomu.
- Wykonano `receiving-code-review`, sprawdzając uwagi w aktualnych helperach/testach mowy, domenowym feedbacku i E2E popup.
- `verification-before-completion` / `finishing-a-development-branch`: adekwatna weryfikacja dokumentacji zamiast suite aplikacji zgodnie z doc-only wyjątkiem AGENTS; integracja dokumentów przez PR, bez merge i bez implementacji produktu.
