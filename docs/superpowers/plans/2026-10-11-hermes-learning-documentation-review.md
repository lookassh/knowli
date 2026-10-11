# Dokumentacja integracji Umiem! / MCP — review 2026-10-11

Zakres bieżącego zadania: poprawić umiejscowienie planowanego MCP/skilla na repo Knowli i dodać do AGENTS.md wymóg sprawdzania ich zgodności przy zmianach API. Nie implementowano API, adaptera, skilla ani instalatora. Plany wykonawcze A/B/C pozostają do przeglądu właściciela.

Base: e0485049a918b9f9f0a4aeed1eec784464e31146. Branch: feature/hermes-mcp-contract-docs. Dokumenty z wcześniejszych etapów tej rozmowy stanowią część całego zakresu review/PR, nie tylko zmiana AGENTS.md.

Checklist:
- [x] using-superpowers/brainstorming/writing-plans: użyte przy projektowaniu w tej rozmowie; obecna korekta dotyczy wyłącznie dokumentacji.
- [x] using-git-worktrees: sprawdzono brak właściwego artefaktu, utworzono managed worktree od wskazanego BASE_SHA; nie zmieniono gałęzi głównego checkoutu.
- [x] Zweryfikowano bieżący Git oraz niepowiązane untracked .zcodeignore/exp-a.mjs/exp-b.mjs; nie dołączono ich do pracy.
- [x] AGENTS: planowane źródła integrations/umiem-mcp oraz skills/umiem-learning/SKILL.md, aktualizacja API → MCP → skill i testy albo uzasadnienie braku wpływu w jednym PR.
- [x] Spec/folder-structure/plany: A API w Knowli, B MCP+skill w Knowli, C konsument i wdrożenie w Hermes-szkola; schema i release wspólnego commita, bez lokalnego forka u Hermesa.
- [x] Przegląd własny: brak deklaracji wdrożonego MCP; konkretne docelowe ścieżki, osobne Python checks i skill-loader verification u konsumenta.
- [x] Weryfikacja dokumentów: Markdown fences, whitespace także nowych plików, git diff --check, JSON parsing i spójność przykładu czasu (1380/1980 sekund). Nie uruchamiano testów aplikacji — nie zmieniono kodu. Dokumentacyjny wyjątek AGENTS.md pozwala bez RED i planu wykonania dokumentacji.
- [x] requesting-code-review: niezależny dedykowany recenzent gpt-6.1-sol, high, poza GPT Astra; cały diff BASE..HEAD oraz niezacommitowane dokumenty, spec i wymagania użytkownika.
- [x] receiving-code-review: zweryfikowane i rozwiązane Critical/Important, Minor jawnie zanotowane.
- [x] Końcowe verification-before-completion: git diff --cached --check, Markdown fences, JSON oraz sumy. Finishing-a-development-branch wybiera autoryzowane przez AGENTS.md push gałęzi i PR do main; wynik publikacji zapisany w PR i załączniku rozmowy. Bez merge i wdrożenia.

Nie wykonano executing-plans/TDD, ponieważ w tym zadaniu poprawiono dokumentację i zasady utrzymania, a nie zaimplementowano planów A/B/C. Nie wywołano Coolify, nie wydano tokenu ani nie wysłano danych dzieci lub wiadomości WhatsApp.

## Wynik niezależnego review

Dedykowany recenzent gpt-6.1-sol/high, read-only, przejrzał osiem dokumentów i adekwatny aktualny kod obu projektów. Critical: 0; Important: 0. Minor: plan A:9 nadal mówił o braku SDK MCP w całym Knowli. Zweryfikowano i poprawiono na brak SDK w web/worker/domenie, z SDK tylko w pakiecie planu B. Poprawka dotyczy jednego zdania, skontrolowana przez wykonawcę. Brak odłożonych uwag. Werdykt recenzenta: gotowe do dokumentacyjnego PR.

Review nie oceniał gotowości przyszłego API/MCP/skilla, realnego połączenia produkcyjnego, loadera skilla ani dostarczenia Evening. Te dowody i akceptacja wykonania A/B/C pozostają kolejnymi etapami.
