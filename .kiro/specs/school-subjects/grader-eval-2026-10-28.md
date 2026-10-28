# Ewaluacja gradera szkolnego — przebieg bramki (2026-10-28)

Dowód przebiegu bramki jakości Etapu 2 na złotym zestawie
`grader-golden-set.json` (20 przypadków, 4 pytania; wyłącznie fikcyjne
odpowiedzi). Przebieg po poprawkach z workflow code review Etapów 1–2
(m.in. pełna partycja elementów w walidatorze, prompt `school-grader-v2`,
harness porównujący także brakujące elementy i formę).

- Komenda: `corepack pnpm eval:school-grader`
- Model: `deepseek/deepseek-v4.1-flash` (konfiguracja `UMIEM_GRADER_*` z `.env`)
- Wersja promptu: `school-grader-v2`
- Data: 2026-10-28

Wyjście:

```
arm=real model=deepseek/deepseek-v4.1-flash promptVersion=school-grader-v2
przypadki=20 wiedzaZgodna=19 (95%) precyzjaZgodna=18 brakujaceElementyZgodne=19/20 formaZgodna=2/2 odrzucone=0
 - G05 (błędna zależność mimo słów kluczowych): brakujące elementy [e1,e2,e3] ≠ [e1,e2]
 - G20 (częściowo poprawna — elementy mieszane z błędem drobnym): wiedza incorrect ≠ partial
BRAMKA: OK
```

Uwagi:

- Przypadki twarde (słowa kluczowe przy błędnej zależności, istotny błąd
  rzeczowy): wiedza zgodna we wszystkich; w G05 różni się tylko partycja
  elementów (model oznaczył też e3 jako brakujący), nie wymiar wiedzy.
- Jedyny rozjazd wiedzy: G20 (oczekiwane `partial`, model `incorrect`) —
  przypadek graniczny znany z wcześniejszego przebiegu; bramka ≥90% spełniona.
- Pojedynczy przebieg, n=20: wynik jest bramką regresji, nie dowodem
  stabilności statystycznej. Powtórka po zmianie modelu/promptu: ta sama
  komenda; `--fake` służy wyłącznie sanity checkowi pipeline'u.
- Kalibracja limitu wywołań gradera na sesję pozostaje otwarta do pilotażu
  (limit domyślny 20).
