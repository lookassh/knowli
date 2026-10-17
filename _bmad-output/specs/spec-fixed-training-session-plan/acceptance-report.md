# Odbiór: stała lista zadań sesji

Data odbioru: 2026-10-17  
Branch: `investigate/task-transition-latency`

## Wynik

Implementacja zadań 1–3 jest lokalnie zapisana w trzech commitach:

| Zadanie | Commit |
| --- | --- |
| Trwały plan treningu słówek | `a8c5f076193206df929ee96e50dcf44022ac815b` |
| Stałe plany treningu lekcji | `aee97ee84bf370d18c161daf5a8cd97fc6b1adf9` |
| Natychmiastowa reakcja i stabilny ekran | `21fd83a991f66c7f2eb71f7400d2f762ac951de0` |

Plany słówek i lekcji są prywatnym, niezmiennym snapshotem sesji. Migracja `0017_fixed_training_session_plan.sql` dodaje plan bez przesyłania go w Kid DTO. Nowe sesje wydają zapisane sloty, a stare sesje bez planu zachowują ścieżkę legacy. Testy domeny, integracyjne i E2E obejmują stałość listy, dostosowanie kolejnej sesji, lekcje, wznowienie i współbieżność. Kid UI natychmiast pokazuje neutralny wybór i stan oczekiwania, zachowuje geometrię ekranu i czyści przejście po retry, w tym po błędach audio i podpowiedzi.

## Sprawdzenia kodu

Po ostatniej zmianie kodu, przed zmianami dokumentacyjnymi z tego odbioru, wykonano:

- `pnpm test:unit`: 136 plików, 1285 testów — PASS.
- `pnpm test:integration`: 47 plików, 443 testy PostgreSQL — PASS.
- `pnpm test:e2e`: 198 testów — PASS.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS.

Story 3 przeszła niezależne, read-only review całego diffu modelem GPT-6.1 Sol, medium. Reviewer zgłosił problemy z flagami retry audio i podpowiedzi; dodano regresje, poprawiono implementację, ponowiono pełne sprawdzenia i końcowe review nie znalazło uwag. Story 2 również przeszła końcowe niezależne review po poprawce schedulera. Committowanie następowało dopiero po zielonych kontrolach i czystym review.

## Pomiary i ograniczenia

Wymagany baseline sprzed implementacji nie został zebrany. Nie znaleziono pomiarów p50/p95 ani surowych próbek w pakiecie specyfikacji, dokumentacji i historii implementacyjnej. Wobec tego porównania przed/po dla `start`, `next`, `complete`, `attempts`, `activity`, blokad/SQL oraz całego przejścia nie da się odtworzyć i nie deklarujemy poprawy czasu p95.

E2E Story 3 sprawdza, że neutralna reakcja interfejsu i status przejścia pojawiają się, gdy fikcyjne żądanie activity nadal czeka. To test kolejności widocznej reakcji, a nie pomiar 5 rozgrzewek + 30 próbek × 3 serie; nie daje p50/p95 ani dowodu spełnienia celu 100 ms. Nie wykonano też odbioru na fizycznym urządzeniu referencyjnym. Czas transportu `activity` nadal może wpływać na gotowość kolejnego ekranu. Ilościowy CAP-6 pozostaje niepotwierdzony.

## API, MCP, skill i wdrożenie

Pomiędzy `66a0717` a implementacją nie zmieniono `packages/contracts/src/kid.ts`, routera Kid API, endpointów integracji MCP ani pakietu `integrations/umiem-mcp`. Dodany tekst w `packages/contracts/src/messages.ts` jest komunikatem UI. Prywatny plan sesji nie trafia do DTO; `learning-overview` nadal wyklucza lekcje i niewydane sloty. Aktualizacja API → MCP → skill nie jest wymagana, a instalacja Hermesa nie wymaga zmiany.

Kolejność wdrożenia pozostaje: kompatybilna migracja `0017` → serwer obsługujący sesje legacy i sesje z planem → klient Kid UI. Nowe plany są trwałe i niezmienne; starsze binarium nie obsługuje zapisanego planu i nie jest bezpiecznym rollbackiem po rozpoczęciu nowych sesji. Preferowany jest roll-forward; awaryjny rollback wymaga uzgodnionej obsługi lub zakończenia sesji z nowym planem.

Ostatni komplet testów i build dotyczył dokładnie kodu commita `21fd83a`; po nim zmieniono wyłącznie dokumentację. Status testów nie jest deklaracją pomiaru wydajności ani akceptacji na urządzeniu.
