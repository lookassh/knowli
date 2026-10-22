# Quick Task 261021-lsw: Automatyczne nagrywanie z VAD na ekranach mowy - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning

<domain>
## Task Boundary

Ekran z rozpoznawaniem słów (mówienie → system rozpoznaje) nie działa najlepiej: wrażenie ucinania dźwięku wysyłanego do STT. Dziecko naciska przycisk i od razu mówi, zanim inicjalizacja rejestratora się zakończy. Proponowane rozwiązanie: automatyczny start nagrywania po wyświetleniu ekranu, automatyczny stop po wykryciu wypowiedzianego słowa i następującej po nim ciszy (VAD), sygnał dźwiękowy bip na początku i na końcu nagrywania.

</domain>

<decisions>
## Implementation Decisions

### Zakres ekranów
- Oba ekrany mowy: SpeechView (powtórz słowo) i PictureSpeechView (obrazek → powiedz słowo). Wspólna logika autostartu + VAD w współdzielonym komponencie, spójne UX.

### Przycisk nagrywania
- Tryb automatyczny: nagrywanie startuje samo po wyświetleniu ekranu. Przycisk zostaje jako „Spróbuj jeszcze raz" po próbie oraz fallback, gdy autodetekcja zawiedzie.

### Auto-stop (VAD)
- Stop po wykryciu mowy i ~1,2 s ciszy, następnie wysyłka na serwer. Istniejący limit maksymalnej długości nagrania zostaje jako zabezpieczenie.
- Gdy dziecko milczy — czekamy (ewentualnie podpowiedź); cisza nie tworzy próby/oceny, zgodnie ze SPEC i AGENTS.md („cisza, niepewne rozpoznanie i awaria techniczna nie są dowodem błędnej wiedzy").

### Dźwięki bip
- Syntetyczne bip generowane WebAudio w przeglądarce, bez plików audio.
- Bip startu odtwarzany PRZED włączeniem nagrywania, bip końca PO zatrzymaniu — tak, aby nie wpadały do nagrania wysyłanego na STT.

### Claude's Discretion
- Szczegóły progów VAD (próg głośności, okno analizy, debounce), wygląd wskaźnika nagrywania, dokładne brzmienie/wysokość bipów, obsługa przypadków brzegowych (odmowa uprawnienia mikrofonu, błąd urządzenia, powrót do ekranu).
- Ewentualna pre-inicjalizacja mikrofonu (np. szybkie przygotowanie strumienia po wejściu na ekran, żeby nie gubić początku wypowiedzi) — dopuszczalne, jeśli uprości skuteczność fixu.

</decisions>

<specifics>
## Specific Ideas

- Istniejąca infrastruktura w `packages/kid-ui/src/media/browser.ts`: `SpeechRecorder` na MediaRecorder z `#startLevelMonitor` (AnalyserNode, fftSize 256) do wskaźnika poziomu oraz limit maksymalnej długości nagrania. Detekcja mowy to naturalne rozszerzenie istniejącego monitora poziomu.
- Komponenty do zmiany: `packages/kid-ui/src/exercises/SpeechView.tsx`, `PictureSpeechView.tsx`, `SpeechRecordButton.tsx`, `media/browser.ts`, `media/platform.ts` (adaptery platformowe).
- Zasada AGENTS.md: nagranie dziecka przetwarzane krótkotrwale w pamięci; zwolnienie mikrofonu i buforów także po błędzie/anulowaniu.

</specifics>

<canonical_refs>
## Canonical References

- `docs/SPEC.md` — zasady oceny mowy, cisza/niepewność nie są błędem wiedzy
- `docs/architecture.md` — STT sprawdza treść, osobny provider ocenia wymowę; zatwierdzone warianty poprawne także w mowie
- `AGENTS.md` — prywatność nagrań, feedback odpowiadający rzeczywistemu wynikowi

</canonical_refs>
