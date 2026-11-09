# Stan aplikacji i granice wdrożenia

Odczyt lokalny 2026-10-16, HEAD `3245238`. Nie implementowano funkcji, nie instalowano zależności i nie wykonywano testów aplikacji w ramach specyfikacji.

| Obszar | Miejsce i granica |
| --- | --- |
| Pomiar | `packages/kid-ui/src/session/useLearningSession.ts` obsługuje visibility/blur/offline dla mikrofonu i odświeżania; to nie gotowy pomiar nagrodowy. Dodać adapter sygnałów i stan bez importu Next/server. |
| Serwer | Wspólne use cases w `packages/server/src/modules/sessions.ts` i ścieżkach lekcji/kartkówek; rozliczać odcinki bez zmiany znaczenia stanów nauki. |
| Kontrakty | `packages/contracts/src/kid.ts` i schematy nagród w tym pakiecie; czas/punkty/cel i zgłoszenia, bez kluczy odpowiedzi. Endpointy i kompatybilność ustala plan story. |
| UI dziecka | `DeckScreen.tsx`, `SummaryScreen.tsx`, omówienie kartkówki, `packages/contracts/src/messages.ts`; bez tickera sekund i administracji dziecka. |
| Rodzic | Chroniony podgląd dnia i decyzje w `apps/web`, autoryzacja każdej operacji. |
| Dane | Drizzle w `packages/server/src/db/schema.ts` i przeglądane migracje PostgreSQL; nie rozwijać niezależnie początkowego SQL z docs. |

`endSession()` może ustawić treningowi `completed` po ręcznym końcu. Nie daje to stałej nagrody: liczymy rozliczony czas. `tasksIssued` i liczba ocen nie są czasem pracy.

## Znaczenie i trwałość danych

Utrwalić odtwarzalne odcinki, punkty z pochodzeniem zestawu/sesji, bloki źródłowego dnia i ich wykorzystanie, rundę z przypiętą wersją oraz rezerwacje/realizacje. To znaczenie danych, nie gotowe nazwy tabel lub framework. Unikalność odcinków/punktów/bloków/komend i transakcje chronią race; blokada jednej sesji nie chroni sama salda dziecka na dwóch klientach.

Kasowanie dziecka obejmuje nowe dane; archiwizacja zachowuje dorobek. Bez audio, surowych klawiszy lub ruchów myszy i bez dodatkowego modelu oceniającego uczciwość. Runda lekcji zachowuje istniejący kontrakt oceny i granice przedmiotów.

## Raport MCP pozostaje osobny

`packages/server/src/domain/learning-time.ts` liczy odstępy aktywności do 120 s, scala nakładanie i zwraca `estimated: true`. Raport `learning-overview` wyłącza lekcje. Nie zastępujemy go czasem nagrody i nie dopisujemy punktów do prób lub opanowania.

Przy zmianie API sprawdzić wpływ na adapter `/api/mcp`, walidację, JSON Schema i `integrations/umiem-mcp/skills/umiem-learning/SKILL.md`. Zakres: Kid/Parent API nagród, bez punktów i sterowania Xbox w `umiem_get_learning_overview`. Przy niezmienionym raporcie zachować schemaVersion i filtr lekcji, uzasadnić brak zmian MCP/skilla w dzienniku/PR i potwierdzić testami kontraktu oraz standardowego klienta Streamable HTTP. Zmiana repo nie aktualizuje instalacji Hermesa.

## Weryfikacja implementacji

Story 1: kontrolowany zegar, tło/fokus, offline, bezczynność, wolne czytanie/mowa, serwerowy czas, dwa klienty i inspekcja. Story 2: reszty minut, suma zestawów, granice dni/DST i odtworzenie. Story 3: budżet, bezpieczny scheduler i brak progu poprawności. Story 4: fakty i Parent auth. Story 5: transakcje salda/bloków, retry i pełny przepływ UI.

Użyć adekwatnych `test:unit`, `test:integration`, `test:e2e`, `typecheck`, `build`, `test:mcp` po sprawdzeniu package.json. Dane na PostgreSQL, providerzy fake. R01/R03/R04/R05/R07 chronią retry, trwałość/kasowanie, exposure, scheduler i mowę. Nie deklarować odbioru telefonu na podstawie emulacji. Nie tworzyć PR ani wdrażać z samej specyfikacji.
