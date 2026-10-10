# Model subagentów review

## Zakres i checklista

Polecenie właściciela: review ma używać `gpt-6.1-sol` zamiast Astry. Zakres: reguła w `AGENTS.md`, obejmująca także subagenta `review_fixes` widocznego w zgłoszeniu. Bez zmian aplikacji ani globalnej konfiguracji Codex.

- [x] Sprawdzenie stanu: czysty, istniejący worktree, detached HEAD; baza `96ddc07f54203493eb69d78dc0ad37102b95623d` równa lokalnemu `origin/main`.
- [x] Zapis jawnego wyboru modelu i pierwszeństwa przed instrukcjami skillsów; zachowanie wymogu zgody na delegację implementacji.
- [x] Weryfikacja treści, spójności i `git diff --check`: exit 0.
- [x] Niezależny review całego diffu na `gpt-6.1-sol` i obsługa uwag: brak Critical, Important i Minor.
- [ ] Końcowa weryfikacja, commit, push gałęzi roboczej i PR do `main`.

## Dostosowanie workflow

Zastosowane skillsy: `using-superpowers`, `using-git-worktrees` (sprawdzenie istniejącej izolacji), `requesting-code-review`, `verification-before-completion`, `finishing-a-development-branch`.

Zgodnie z wyjątkiem dokumentacyjnym w `AGENTS.md` nie powstaje specyfikacja ani plan implementacji, nie ma TDD ani testów aplikacji. Weryfikacja obejmuje dokumenty i diff. Integracja przez PR zgodnie z repo; scalanie pozostaje po stronie właściciela, worktree zostaje do obsługi PR.

## Wynik review

Recenzent `review_model_policy`, osobny subagent z jawnym `model: "gpt-6.1-sol"`, `reasoning_effort: "high"` i `fork_turns: "none"`, sprawdził cały niezacommitowany zakres: diff `AGENTS.md` oraz cały ten dokument. Tryb read-only, bez dalszej delegacji. BASE_SHA = HEAD_SHA = `96ddc07f54203493eb69d78dc0ad37102b95623d`; zakres roboczy jest częścią review.

Review Focus: dokładny model, jawny wybór przy uruchomieniu, zakres etapów review i poprawek, pierwszeństwo nad skillami, zachowanie zgody na delegację. Wynik: gotowe do PR; brak Critical, Important i Minor. Recenzent potwierdził `git diff --check` i `git diff --no-index --check` nowego pliku: exit 0.

Wykonawca zweryfikował wynik według `receiving-code-review`: reguła odpowiada poleceniu właściciela, nie ma uwag wymagających poprawek. Recenzent odłożył zachowanie aplikacji/testy (bez zmian produktu), potwierdzenie historycznego czystego stanu i przyszłą integrację. Decyzja wykonawcy: testy aplikacji pozostają poza zakresem zgodnie z wyjątkiem dokumentacyjnym; czysty stan początkowy potwierdził odczyt Git przed edycją; commit/push/PR są kolejnym krokiem. Koszt: brak weryfikacji produktowej przy zmianie samych instrukcji; integracja wymaga osobnego potwierdzenia wyniku narzędzi.
