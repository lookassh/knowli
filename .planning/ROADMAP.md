# Roadmap: Knowli

## Milestones

- 🚧 **Operationalna akceptacja istniejącego MVP** — uzyskanie aktualnych dowodów, że prywatna instalacja Umiem! uruchamia się, odzyskuje dane i prowadzi rzeczywistą rodzinną sesję.

## Phases

- [ ] **Phase 1: Prywatne wdrożenie i odzyskanie danych** - Potwierdzenie uruchomienia, trwałości po restarcie i odtworzenia danych istniejącego stosu.
- [ ] **Phase 2: Odbiór rodzinnej sesji na urządzeniu** - Potwierdzenie zatwierdzonego przez rodzica przepływu dziecka, historii per umiejętność i uczciwego zachowania ścieżek audio.

## Phase Details

### Phase 1: Prywatne wdrożenie i odzyskanie danych
**Goal**: Operator może prywatnie uruchomić istniejący stos Umiem! i odzyskać jego dane bez utraty materiału ani historii nauki.

**Depends on**: Nothing (first phase)

**Requirements**: OPS-01, OPS-02, REC-01

**Success Criteria** (what must be TRUE):
  1. Operator uruchamia prywatny stos z jedną instancją web, workerem i PostgreSQL; migracje kończą się przed gotowością usług, a udokumentowane healthchecki potwierdzają działanie.
  2. Po kontrolowanym restarcie weba i workera rodzic oraz dziecko nadal otrzymują zatwierdzony materiał, zapisaną historię, projekcje postępu i gotowe media.
  3. Operator odtwarza sprawdzony backup do oddzielnej pustej instancji i potwierdza tam profile, opublikowaną wersję materiału, historię prób oraz media.

**Plans**: TBD

### Phase 2: Odbiór rodzinnej sesji na urządzeniu
**Goal**: Rodzic może przeprowadzić zatwierdzony materiał przez krótką, wiarygodnie zapisaną sesję dziecka na rzeczywistym urządzeniu, również bez mikrofonu.

**Depends on**: Phase 1

**Requirements**: FLOW-01, FLOW-02, HIST-01, SPEECH-01

**Success Criteria** (what must be TRUE):
  1. Rodzic przygotowuje lub wybiera materiał, sprawdza go, zatwierdza i przypisuje wybranemu dziecku przed rozpoczęciem jego nauki.
  2. Dziecko kończy na rzeczywistym telefonie lub tablecie sesję około 5–10 minut bez mikrofonu, także po odmowie uprawnienia, bez utraty już zapisanych odpowiedzi.
  3. Po sesji rodzic widzi historię i postęp właściwego dziecka oddzielnie dla rozpoznawania, przypominania, wymowy i pisowni, z poprawnym oznaczeniem odpowiedzi samodzielnych, wspieranych oraz nieocenionych.
  4. Zmiana widocznego obszaru przez klawiaturę, zoom, tło lub chwilową utratę sieci nie tworzy lokalnego sukcesu ani nie gubi bieżącego zadania; potwierdzony wynik pozostaje po odświeżeniu.
  5. Gdy ścieżka mowy jest skonfigurowana, próba z prawdziwą mową dziecka potwierdza, że aplikacja rozdziela rozpoznaną treść, ocenę wymowy i wynik technicznie nieoceniony; jej ograniczenia są zapisane przed uznaniem ścieżki za gotową.

**Plans**: TBD

**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
| --- | --- | --- | --- |
| 1. Prywatne wdrożenie i odzyskanie danych | 0/TBD | Not started | - |
| 2. Odbiór rodzinnej sesji na urządzeniu | 0/TBD | Not started | - |
