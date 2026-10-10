# Model subagentów review

## Zakres i checklista

Aktualne polecenie właściciela: review ma używać bardzo mocnego agenta, ale nie GPT Astra; bez jednej sztywnej nazwy modelu, ponieważ repo jest używane także przez ZCode i Antigravity. Zakres: reguła w `AGENTS.md`, obejmująca także subagenta `review_fixes` widocznego w zgłoszeniu. Bez zmian aplikacji ani globalnej konfiguracji klientów.

- [x] Sprawdzenie stanu: czysty, istniejący worktree, detached HEAD; baza `96ddc07f54203493eb69d78dc0ad37102b95623d` równa lokalnemu `origin/main`.
- [x] Zapis jawnego wyboru modelu i pierwszeństwa przed instrukcjami skillsów; zachowanie wymogu zgody na delegację implementacji.
- [x] Weryfikacja treści, spójności i `git diff --check`: exit 0.
- [x] Niezależny review całego diffu na `gpt-6.1-sol` i obsługa uwag: brak Critical, Important i Minor.
- [x] Końcowa weryfikacja: `git diff --check` i `git diff --cached --check`, exit 0; commit `586b8d4`, push `feature/review-model-sol` i [PR #34 do `main`](https://github.com/lookassh/knowli/pull/34). Scalanie przez właściciela.

## Dostosowanie workflow

Zastosowane skillsy: `using-superpowers`, `using-git-worktrees` (sprawdzenie istniejącej izolacji), `requesting-code-review`, `verification-before-completion`, `finishing-a-development-branch`.

Zgodnie z wyjątkiem dokumentacyjnym w `AGENTS.md` nie powstaje specyfikacja ani plan implementacji, nie ma TDD ani testów aplikacji. Weryfikacja obejmuje dokumenty i diff. Integracja przez PR zgodnie z repo; scalanie pozostaje po stronie właściciela, worktree zostaje do obsługi PR.

## Wynik pierwszego review (poprzednia reguła)

Recenzent `review_model_policy`, osobny subagent z jawnym `model: "gpt-6.1-sol"`, `reasoning_effort: "high"` i `fork_turns: "none"`, sprawdził cały niezacommitowany zakres: diff `AGENTS.md` oraz cały ten dokument. Tryb read-only, bez dalszej delegacji. BASE_SHA = HEAD_SHA = `96ddc07f54203493eb69d78dc0ad37102b95623d`; zakres roboczy jest częścią review.

Review Focus: dokładny model, jawny wybór przy uruchomieniu, zakres etapów review i poprawek, pierwszeństwo nad skillami, zachowanie zgody na delegację. Wynik: gotowe do PR; brak Critical, Important i Minor. Recenzent potwierdził `git diff --check` i `git diff --no-index --check` nowego pliku: exit 0.

Wykonawca zweryfikował wynik według `receiving-code-review`: reguła odpowiada poleceniu właściciela, nie ma uwag wymagających poprawek. Recenzent odłożył zachowanie aplikacji/testy (bez zmian produktu), potwierdzenie historycznego czystego stanu i przyszłą integrację. Decyzja wykonawcy: testy aplikacji pozostają poza zakresem zgodnie z wyjątkiem dokumentacyjnym; czysty stan początkowy potwierdził odczyt Git przed edycją; commit/push/PR są kolejnym krokiem. Koszt: brak weryfikacji produktowej przy zmianie samych instrukcji; integracja wymaga osobnego potwierdzenia wyniku narzędzi.

## Aktualizacja: mocny model bez GPT Astra

Pierwsza reguła wymuszająca `gpt-6.1-sol` została zastąpiona na polecenie właściciela. Powyższa checklista i review dokumentują wcześniejszy etap, nie potwierdzają nowej reguły.

- [x] Sprawdzenie czystego worktree na `feature/review-model-sol`, HEAD `3b9a1a5146b9da7507d28855ddb3b5abde0bfcf2`; PR #34 pozostaje otwarty.
- [x] Zapis reguły niezależnej od klienta: najbardziej zaawansowany dostępny model z wykluczeniem GPT Astra, jawny wybór właściwym mechanizmem klienta, ten sam zakres review i poprawek oraz wymóg zgody na delegację.
- [x] Kontrola treści i diffu oraz niezależny review całego zakresu PR, z uwzględnieniem aktualizacji roboczej: brak Critical, Important i Minor; `git diff --check` względem bazy — exit 0.
- [ ] Końcowa weryfikacja, commit, push i aktualizacja tytułu/opisu PR #34.

Recenzent `review_portable_model_policy` (`gpt-6.1-sol`, `high`, `fork_turns: "none"`) przejrzał niezależnie cały zakres od `96ddc07` do `3b9a1a5` wraz z diffem roboczym obu plików. Wynik: gotowe do dalszego workflow PR, brak uwag; tryb read-only, bez delegacji. Wybór Sol w tej sesji jest konkretnym wyborem dla dostępnego środowiska, a nie wymogiem dla innych klientów.

Weryfikacja uwag według `receiving-code-review`: brak poprawek. Recenzent pozostawił poza oceną zachowanie aplikacji/testy, faktyczną dostępność modeli w ZCode i Antigravity, historyczny czysty stan oraz przyszłą integrację. Decyzja wykonawcy: wyjątek dokumentacyjny pozostaje zasadny; reguła wymaga sprawdzania modeli w danym kliencie przy uruchamianiu, a konfiguracji tych klientów nie zmieniano ani nie uruchamiano; stan początkowy potwierdzono przed edycją, integracja zostanie potwierdzona wynikami narzędzi. Koszt: brak dowodu wykonania tej instrukcji w ZCode/Antigravity w tym zadaniu.
