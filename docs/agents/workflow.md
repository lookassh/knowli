# Proces pracy: BMAD i Superpowers — szczegóły dla agentów

Ustalenie właściciela z 2026-11-10. BMAD służy do odkrywania i rozbijania funkcji na historyjki z kryteriami akceptacji, Superpowers do planu i implementacji. Jedno narzędzie na każdy krok, żeby skille nie przejmowały sobie nawzajem zadania.

## Kroki

1. **Odkrywanie** (pomysł jeszcze mglisty, wybór wariantu): `bmad-brainstorming`, `bmad-forge-idea`, `bmad-ux`, `bmad-architecture`; do podważenia gotowej wersji `bmad-party-mode` albo `bmad-advanced-elicitation`. Wyniki w `_bmad-output/`.
2. **Spec — jeden na funkcję, z jednego narzędzia:**
   - funkcja do rozbicia na kilka historyjek: `bmad-spec` → `_bmad-output/specs/<spec>/` (`SPEC.md`, `acceptance-scenarios.md` z wierszami `AC-xx`, `stories.yaml`);
   - funkcja na jeden plan i jeden PR: `superpowers:brainstorming` → `docs/superpowers/specs/`.

   Nie pisz drugiego specu tej samej funkcji drugim narzędziem.
3. **Plan:** `superpowers:writing-plans` → `docs/superpowers/plans/`. Dla historyjki BMAD — jeden plan na story, a jego specem są: `description` story, przywołane w nim wiersze `AC-xx` z `acceptance-scenarios.md` i `invoke_dev_with` jako ograniczenia; plan odsyła do `SPEC.md` i plików tematycznych zamiast je kopiować. Każde AC przywołane w story ma w planie zadanie z testem, który je sprawdza (wiersz AC → test). `spec_checkpoint: true` — przed implementacją pokaż plan właścicielowi do akceptacji; `done_checkpoint: true` — po story zatrzymaj się na odbiór, zanim zaczniesz następne.
4. **Implementacja:** `superpowers:subagent-driven-development` (albo `superpowers:executing-plans`, gdy zadania są mocno powiązane). Recenzja zadań sprawdza zgodność z AC story.
5. **Przed PR:** spec, plan i gotowa gałąź przechodzą przegląd trzech niezależnych krytyków; na końcu `/ponytail:ponytail-review` na gałęzi, potem PR (story albo etap = osobny PR).

## `bmad-build`

Tylko na wyraźne polecenie właściciela (np. mała, jednocelowa poprawka). Nie uruchamiaj go samodzielnie, mimo że jego opis zgłasza go do każdej delegowanej zmiany. Jego specy trafiają do `_bmad-output/implementation-artifacts/`.

## Review — jedna ścieżka

- **Per zadanie:** recenzja wbudowana w `superpowers:subagent-driven-development` (zgodność ze specem i AC, jakość).
- **Przed PR:** trzej niezależni krytycy na gotowej gałęzi, potem `/ponytail:ponytail-review`.
- Pozostałe narzędzia przeglądu — `bmad-code-review`, `bmad-review`, `superpowers:requesting-code-review`, `engineering:code-review`, wbudowane `/code-review` — tylko na wyraźne polecenie właściciela; nie dokładaj ich samodzielnie do powyższej ścieżki.
