# Deferred Work

- source_spec: `C:\Users\looka\.gemini\antigravity\worktrees\knowli\fix_study_keyboard_navigation\docs\bmad\implementation-artifacts\spec-fix-study-keyboard-navigation.md`
  summary: Brak dedykowanego testu jednostkowego dla wewnętrznego komponentu RevealActions w LearnScreen.
  evidence: RevealActions jest wewnętrznym sub-komponentem LearnScreen.tsx, którego całościowe zachowanie po ujawnieniu słowa podlega weryfikacji w testach przepływu ekranów / e2e.
- source_spec: `C:\Users\looka\.zcode\worktrees\knowli\main-2026-10-19\docs\bmad\implementation-artifacts\spec-picture-to-word-choice.md`
  summary: Zasianie par mylących picture_recognition pomyłkami reverse_recognition (wspólny kierunek source_to_target) na zimny start nowego typu.
  evidence: BH14 z review 2026-10-19 — filtr `pair.exerciseType === "picture_recognition"` startuje z pustą historią konfuzji, choć pomyłki reverse_recognition w kierunku source_to_target są semantycznie tożsame; ulepszenie, nie wada — rozstrzygnęłoby połączenie źródeł par w learning-snapshot i obserwacja doboru dystraktorów po pierwszych realnych sesjach.
