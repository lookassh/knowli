# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-21)

**Core value:** Rodzic zatwierdza materiał, dziecko uczy się w krótkiej sesji także bez mikrofonu, a system zachowuje wiarygodną historię per umiejętność.

**Current focus:** Phase 1 — Prywatne wdrożenie i odzyskanie danych.

## Current Position

**Phase:** 1 of 2 — Prywatne wdrożenie i odzyskanie danych\
**Plan:** Not planned\
**Status:** Ready for phase planning\
**Progress:** [░░░░░░░░] 0%

## Performance Metrics

| Metric | Value |
| --- | --- |
| Roadmap phases complete | 0/2 |
| Plans complete | 0/TBD |
| Active requirements complete | 0/7 |
| Requirement coverage | 7/7 mapped |

## Accumulated Context

### Decisions

- This is a brownfield operational-acceptance roadmap. Existing material, session, history and UI capabilities are not scheduled for reimplementation.
- The roadmap uses the default sequential phase IDs because `.planning/config.json` is absent.
- Private, single-instance deployment remains a boundary. Public access, replicas and native mobile distribution require separate scope decisions.

### Evidence and open work

- Codebase mapping dated 2026-10-21 identifies a substantially implemented stack: Next.js web/API/MCP host, portable Kid UI, server domain, PostgreSQL/Drizzle and worker.
- This planning run did not execute test suites, Compose, a migration, backup/restore, physical-device flows or a real speech-provider trial.
- Current documented evidence gap: complete Compose smoke/restart, backup restore to a clean instance, real-device child acceptance and real-child speech calibration.

### Blockers

- None for Phase 1 planning. Running a real speech acceptance in Phase 2 requires a target device, consent to use the configured provider and a suitable test session with the child.

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 261021-lsw | Automatyczne nagrywanie z VAD na ekranach mowy (SpeechView/PictureSpeechView): auto-start po wyświetleniu zadania, auto-stop po mowie + ~1,2 s ciszy, bip WebAudio start/koniec, cisza bez próby; fix ucinania początku wypowiedzi (bip za getUserMedia, hook onMicrophoneReady) | 2026-10-21 | 52c55c1 | Needs Review | [261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz](./quick/261021-lsw-ekran-z-rozpoznawaniem-s-w-czyli-tam-gdz/) |

## Session Continuity

**Last action:** Created brownfield PROJECT, REQUIREMENTS, ROADMAP and STATE artifacts from current repository documents and codebase mapping.

**Last activity:** 2026-10-21 - Completed quick task 261021-lsw: automatyczne nagrywanie z VAD na ekranach mowy (gałąź fix/speech-recognition; weryfikacja human_needed — kalibracja VAD, bipy i e2e na urządzeniu po stronie właściciela)

**Next action:** Run `$gsd-plan-phase 1` to turn private deployment and recovery criteria into an executable plan.

**Resume note:** Recheck current repository and deployment state before treating historical test/deploy reports as current proof. Preserve the untracked ingest artifacts and do not overwrite unrelated user changes.
