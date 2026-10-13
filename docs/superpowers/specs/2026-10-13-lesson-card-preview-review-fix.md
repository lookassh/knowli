# Podgląd kart rodzica — uzupełnienie P2-10 z review PR #51

Cel: spełnić istniejące wymaganie 3.3 modułu lekcji: rodzic widzi tekst kart wyjaśnienia oraz poprawia przykłady przed publikacją.

Rozszerzyć wyłącznie autoryzowany katalog rodzica `GET /api/v1/parent/lesson-catalog`: każdy cel otrzymuje `cards: [{title, body}]`, bez descriptionEn, promptów, kategorii błędów, kluczy odpowiedzi ani danych dzieci. Jest to addytywne pole. Klient używa kolejności kart katalogu i podstawia aktualne lokalne przykłady w miejsce `{{examples}}`, tak jak domenowy renderCard; po edycji podgląd zmienia się natychmiast. Przykłady zapisują się dotychczasowym PATCH.examples, a opublikowana wersja pozostaje tylko do odczytu. Reguła z katalogu nie podlega edycji.

Alternatywy: osobny endpoint podglądu wymaga dodatkowych żądań przy każdej edycji; kopiowanie tekstów do klienta rozbiega się z katalogiem. Wybrano małe rozszerzenie istniejącego katalogu.

Kontrakt `learning-overview` v1, MCP i skill Hermesa pozostają bez zmian: katalog rodzica nie jest narzędziem MCP, lekcje nadal są wyłączone z raportu. Testy kontraktów i autoryzacji katalogu muszą potwierdzić brak pól modelowych.

Akceptacja: E2E rodzica widzi rzeczywisty tytuł i treść karty, edytuje przykład, widzi go w podglądzie, zapisuje i po ponownym wejściu widzi zachowaną treść; test DTO/endpointu potwierdza wyłącznie bezpieczne pola. Bez nowej migracji ani zmian Kid DTO.
