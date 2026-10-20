# Deferred Work

- source_spec: `C:\Users\looka\.gemini\antigravity\worktrees\knowli\fix_study_keyboard_navigation\docs\bmad\implementation-artifacts\spec-fix-study-keyboard-navigation.md`
  summary: Brak dedykowanego testu jednostkowego dla wewnętrznego komponentu RevealActions w LearnScreen.
  evidence: RevealActions jest wewnętrznym sub-komponentem LearnScreen.tsx, którego całościowe zachowanie po ujawnieniu słowa podlega weryfikacji w testach przepływu ekranów / e2e.
- source_spec: `C:\Users\looka\.zcode\worktrees\knowli\main-2026-10-19\docs\bmad\implementation-artifacts\spec-picture-to-word-choice.md`
  summary: Zasianie par mylących picture_recognition pomyłkami reverse_recognition (wspólny kierunek source_to_target) na zimny start nowego typu.
  evidence: BH14 z review 2026-10-19 — filtr `pair.exerciseType === "picture_recognition"` startuje z pustą historią konfuzji, choć pomyłki reverse_recognition w kierunku source_to_target są semantycznie tożsame; ulepszenie, nie wada — rozstrzygnęłoby połączenie źródeł par w learning-snapshot i obserwacja doboru dystraktorów po pierwszych realnych sesjach.
- source_spec: `docs/bmad/implementation-artifacts/spec-deck-question-count.md`
  summary: Regeneracja łańcucha snapshotów Drizzle (0018–0020 nie mają plików meta/*_snapshot.json, więc db:generate diffuje przeciwko 0017).
  evidence: Łańcuch zerwany przed tą zmianą przez 0018/0019; migracja 0020 konsekwentnie poszła za konwencją ręczną; naprawa wymaga wygenerowania aktualnego snapshotu całego schematu.
- source_spec: `docs/bmad/implementation-artifacts/spec-deck-question-count.md`
  summary: Aktualizacja AGENTS.md („Sesje trwają około 5–10 minut") po podniesieniu domyślnego budżetu sesji do 20 (limit do 15 min).
  evidence: AGENTS.md to plik agent-context wyłączony z edycji w tym buildzie; treść niespójna z zatwierdzoną decyzją o skalowanym limicie max(10 min, 45 s × budżet).
- source_spec: `docs/bmad/implementation-artifacts/spec-client-reward-time.md`
  summary: Przycinanie odsłuchu do długości nagrania działa deklaratywnie — port AudioPlayer w kid-ui nie wystawia metadanych durationMs, więc reporter przekazuje null i limit egzekwuje się dopiero, gdy port je udostępni.
  evidence: Test jednostkowy "clips playback to the recording length" przechodzi (reporter obsługuje durationMs), ale produkcja woła playbackStarted(assetId, null); odnotowane w Review Triage Log (low/defer). Dowiedzie zmiana portu AudioPlayer zwracająca długość zasobu i asercja w teście kontrolera/e2e.
