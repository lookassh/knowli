# Wymagania: Knowli

**Zdefiniowano:** 2026-10-21\
**Najważniejsza wartość:** Rodzic zatwierdza materiał, dziecko kończy krótką sesję również bez mikrofonu, a system zapisuje wiarygodny postęp per umiejętność.\
**Zakres tego pliku:** aktywne wymagania fazy asynchronicznego kończenia sesji oraz wymagania z wcześniejszych faz, których właściciel potwierdził zakończenie.

## v1 Requirements

### Asynchroniczne zakończenie sesji

- [x] **ASYNC-01**: Po zakończeniu ćwiczenia lub kartkówki dziecko od razu widzi zapisane podsumowanie, a oczekiwanie na ocenę aktywności dotyczy wyłącznie pola punktów i nie blokuje dalszych działań.
- [x] **ASYNC-02**: Klient odczytuje trwały status oceny krótkim pollingiem, kontynuuje go po zmianie ekranu lub profilu i po zakończeniu odświeża punkty właściwego dziecka; wynik można odzyskać po odświeżeniu aplikacji.
- [x] **ASYNC-03**: Każda sesja uruchamia najwyżej jedną ocenę aktywności; odczyt statusu nie wywołuje modelu ani ponownego naliczenia, a awaria techniczna zapisuje błąd bez punktów i bez automatycznego ponowienia.
- [x] **ASYNC-04**: Publiczny status Kid API ujawnia wyłącznie bezpieczny, walidowany wynik punktowy; nie rozszerza `learning-overview`, MCP ani skilla Hermesa o punkty lub szczegóły oceny.

### Prywatne wdrożenie i odtwarzanie

- [ ] **OPS-01**: Operator może uruchomić prywatny stos z jedną instancją web, workerem i PostgreSQL, przeprowadzić migracje oraz potwierdzić gotowość usług przez udokumentowane healthchecki.
- [ ] **OPS-02**: Po kontrolowanym restarcie weba i workera aplikacja zachowuje zatwierdzony materiał, historię nauki, projekcje postępu i gotowe media.
- [ ] **REC-01**: Operator może odtworzyć sprawdzony backup do oddzielnej pustej instancji i potwierdzić obecność profili, opublikowanej wersji materiału, historii oraz mediów.

### Rodzinna ścieżka na urządzeniu dziecka

- [ ] **FLOW-01**: Rodzic może przygotować lub wybrać materiał, sprawdzić go, zatwierdzić i przypisać właściwemu profilowi przed rozpoczęciem sesji dziecka.
- [ ] **FLOW-02**: Dziecko może na rzeczywistym telefonie lub tablecie ukończyć sesję trwającą około 5–10 minut bez mikrofonu, także gdy odmówi dostępu do mikrofonu.
- [ ] **HIST-01**: Po sesji rodzic może odczytać trwałą historię i postęp oddzielnie dla właściwego dziecka oraz umiejętności, z rozróżnieniem wyniku samodzielnego, wspieranego i nieocenionego.
- [ ] **SPEECH-01**: Jeżeli instalacja włącza STT i ocenę wymowy, próba na rzeczywistym urządzeniu z prawdziwą mową dziecka potwierdza uczciwe rozróżnienie treści, wymowy i wyniku technicznie nieocenionego; ustalone ograniczenia zostają zapisane przed deklaracją gotowości tej ścieżki.

## Udokumentowana baza już obecna w repozytorium

`docs/SPEC.md` opisuje szerszy MVP: profile dzieci, wersjonowane zestawy słownictwa, generowanie lub ręczne tworzenie materiału, zatwierdzanie przez rodzica, ćwiczenia i adaptacyjne powtórki, TTS/cache, ścieżkę mowy, pełną ścieżkę bez mikrofonu, historię, postęp i raport rodzica. Mapa kodu z 2026-10-21 wskazuje implementację tych obszarów.

Nie są one kopiowane do v1 tego cyklu ani przypisywane do nowych faz. Ich bieżące działanie w runtime nie zostało w tej inicjalizacji ponownie uruchomione ani potwierdzone; wymagania v1 powyżej dostarczają potrzebnych dowodów end-to-end.

## v2 Requirements

### Dostęp i skalowanie

- **ACCESS-01**: Udostępnienie aplikacji poza zaufaną siecią ma mieć osobno zaprojektowaną bramę dostępu i model autoryzacji Kid API.
- **SCALE-01**: Jeśli potrzebne będą repliki weba lub workera, ograniczanie logowań i koordynacja pracy mają zostać zaprojektowane dla wielu procesów przed ich włączeniem.

### Rozszerzenia produktu

- **MOBILE-01**: Dziecięcy host Capacitor/Android może użyć istniejącego przenośnego Kid UI po osobnym zaprojektowaniu dostępu sieciowego, bezpieczeństwa i aktualizacji APK.
- **SOURCE-01**: Nauka z OCR/PDF lub podręczników wymaga osobnego modułu źródłowego oraz walidacji jakości materiału.

## Out of Scope

| Element | Powód |
| --- | --- |
| Publiczne wystawienie bez bramy dostępu | Prywatne Kid API nie jest kontraktem dla Internetu. |
| Mikroserwisy, Redis i alternatywny backend | Naruszają ustalony prosty modularny monolit bez potwierdzonej potrzeby. |
| Pełny offline | Lokalny klient nie może generować fałszywych sukcesów nauki bez serwera. |
| Chat/awatar AI, rankingi, marketplace, płatności, OAuth | Nie są potrzebne do rodzinnej ścieżki MVP. |

## Traceability

| Requirement | Phase | Status |
| --- | --- | --- |
| ASYNC-01 | Phase 1 | Complete |
| ASYNC-02 | Phase 1 | Complete |
| ASYNC-03 | Phase 1 | Complete |
| ASYNC-04 | Phase 1 | Complete |
| OPS-01 | Earlier Phase 1 | Owner-confirmed complete |
| OPS-02 | Earlier Phase 1 | Owner-confirmed complete |
| REC-01 | Earlier Phase 1 | Owner-confirmed complete |
| FLOW-01 | Earlier Phase 2 | Owner-confirmed complete |
| FLOW-02 | Earlier Phase 2 | Owner-confirmed complete |
| HIST-01 | Earlier Phase 2 | Owner-confirmed complete |
| SPEECH-01 | Earlier Phase 2 | Owner-confirmed complete |

**Coverage:**
- v1 requirements: 15 total
- Active in current roadmap: 4 (ASYNC-01 through ASYNC-04)
- Earlier phases owner-confirmed complete: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-21*\
*Last updated: 2026-10-21 after brownfield planning initialization*
