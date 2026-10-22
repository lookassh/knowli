---
phase: "01"
slug: "asynchroniczne-ko-czenie-sesji-i-naliczanie-punkt-w"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-10-21"
---

# Phase 01 — Security

> Weryfikacja zagrożeń z planów fazy po implementacji.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Kid API → session activity result | Zaufany klient dziecka wywołuje publiczne API sesji; obecny model nie uwierzytelnia dziecka. | session UUID, status i przyznane punkty |
| Worker/web → activity reviewer | Serwer przekazuje ograniczony snapshot zadań do oceny aktywności. | treść ćwiczeń i odpowiedzi bez identyfikatorów dziecka |

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering | Finalizacja aktywności | high | mitigate | Fingerprint, blokady transakcyjne i atomowy zapis ledgeru; test współbieżności. | closed |
| T-01-02 | Information Disclosure | Payload providera | high | mitigate | Do providera trafia wyłącznie dozwolony snapshot zadań; test sprawdza brak ID i sekretów. | closed |
| T-01-03 | Information Disclosure | Odczyt wyniku sesji | high | accept | Zaufany Kid API pozostaje bez autoryzacji dziecka zgodnie z `docs/architecture.md` §13; endpoint waliduje UUID i zwraca wyłącznie publiczne DTO `no-store`. Właściciel świadomie akceptuje ryzyko dla prywatnej instancji. | closed |
| T-01-04 | Tampering | Parsowanie statusu klienta | medium | mitigate | Wspólny ścisły schemat DTO odrzuca nieznane stany. | closed |
| T-01-05 | Tampering | Lokalny pending store | medium | mitigate | Wersjonowany minimalny rekord; źródłem wyniku pozostaje serwer. | closed |
| T-01-06 | Tampering | Routing profilu | high | mitigate | Sesja wiąże sessionId i childId; UI aktualizuje wyłącznie zgodne podsumowanie. | closed |
| T-01-07 | Denial of Service | Polling | medium | mitigate | Jeden timer i jeden request w locie; zatrzymanie przy stanie terminalnym/teardown. | closed |
| T-01-08 | Information Disclosure | Podsumowanie dziecka | medium | mitigate | Widok renderuje wyłącznie publiczne DTO i komunikaty. | closed |
| T-01-09 | Information Disclosure | Eksport MCP | high | mitigate | MCP eksportuje wyłącznie learning-overview; brak endpointu activity-result w integracji. | closed |
| T-01-10 | Repudiation | Cykl naliczania | medium | mitigate | E2E wiąże jeden raport, odczyty statusu i wynik z tą samą sesją. | closed |
| T-01-SC | Tampering | Zależności | high | mitigate | Faza nie zmienia manifestów ani lockfile i nie dodaje pakietów. | closed |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01-03 | T-01-03 | `docs/architecture.md` §13 świadomie utrzymuje zaufany Kid API bez autoryzacji dziecka. Dla prywatnej, pojedynczej instancji zaakceptowano, że osoba znająca UUID sesji może odczytać jej ograniczony status i punkty; endpoint nie ujawnia danych providera ani innych szczegółów. | Właściciel projektu | 2026-10-21 |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-21 | 11 | 11 | 0 | gsd-security-auditor; post-acceptance recheck |

## Sign-Off

- [x] Wszystkie zagrożenia mają disposition.
- [x] Zaakceptowane ryzyka udokumentowane w rejestrze (brak na tym etapie).
- [x] `threats_open: 0` potwierdzone.
- [x] `status: verified` ustawione w frontmatter.

**Approval:** verified 2026-10-21 — T-01-03 zaakceptowane przez właściciela.
