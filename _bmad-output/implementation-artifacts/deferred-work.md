## Accepted risk for private use (2026-10-15)
- source_spec: _bmad-output/implementation-artifacts/spec-picture-choice-grid.md
  summary: Older picture clients may not support four-choice prompts when resuming an active session after rollout.
  rationale: The owner confirmed the app is for private home use and accepts updating the household PWA before continuing study after rollout.

- source_spec: _bmad-output/implementation-artifacts/spec-5-wymiana-pelnych-blokow-nauki-na-recznie-przyznany-xbox.md
  summary: Add the parent decision flow for reviewing a pending Xbox request, manually adding time in Xbox Family, and confirming or rejecting the request.
  evidence: The owner chose to split Story 5 because its 2851-token full-flow specification exceeded the BMAD 1600-token scope limit; this follow-up depends on the child request and atomic reservation implemented first.

- source_spec: _bmad-output/implementation-artifacts/spec-usuniecie-rundy-i-szybkie-zestawy.md
  summary: Spójny snapshot wielozapytaniowego odczytu salda i dnia przy równoległym rozliczeniu (medium, problem wcześniejszy).
  evidence: Zarówno dawny readKidRewardSnapshot, jak i bieżący odczyt wykonują osobne SELECT bez repeatable-read; settlement pomiędzy nimi może chwilowo połączyć stare saldo z nowym czasem dnia. Zapis rozliczeń i projekcji pozostaje atomowy; osobna poprawka odczytu wymaga transakcji snapshot lub jednego zapytania.
