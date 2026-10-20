# Przekazanie do ZCode

Czytaj razem ze [specyfikacją](../spec-client-reward-time.md), [projektem](design.md), [migracją](migration.md) i [odbiorem](acceptance.md). To instrukcja wykonania, nie nowy zakres produktu.

## 1. Stan przekazania

- Repozytorium: Knowli / Umiem!.
- Gałąź planistyczna: `plan/session-activity-review`.
- Pełny commit bazowy przekazania: `b0abfca3451e41993e6c4166b2bbf406c4404dee` (main z #101). Pierwotne rozpoznanie wykonano na `c042ab134a8fc4ecae9ec0dedad46e0953a0450e`.
- Dokument główny: `docs/bmad/implementation-artifacts/spec-client-reward-time.md`.
- Właściciel zatwierdził pakiet; status **ready-for-dev**. Przygotowanie przekazania nie jest uruchomieniem implementacji. Wiążący jest aktualny status w frontmatter.
- Kod aplikacji nie został zmieniony. Nie zakładaj, że scenariusze opisane w dokumentach są już testami ani że przeszły.
- Dokumenty trzeba zatwierdzić i zapisać commitem na gałęzi planistycznej przed rozpoczęciem pracy w osobnym worktree. Nie twórz worktree od samego commitu bazowego: zabraknie w nim planu.
- Commitu przekazania nie wpisujemy jako zmyślonego SHA do jego własnej zawartości. Nadawca podaje pełny wynik `git rev-parse HEAD` po commicie. ZCode sprawdza `git show <commit>:docs/bmad/implementation-artifacts/spec-client-reward-time.md`.

Instrukcja AGENTS.md wymaga osobnego worktree ZCode. Nie zmieniaj checkoutu zajętego przez Codex i nie przełączaj w nim gałęzi. Jeżeli gałąź planu jest zajęta, utwórz własną gałąź implementacyjną od commitu przekazania.

## 2. Kolejność czytania

1. AGENTS.md w aktualnym worktree.
2. Specyfikacja główna; jeśli nadal draft, nie traktuj samego przekazania jako zatwierdzenia implementacji.
3. design.md — obowiązujący podział FE / LLM / kod serwera.
4. migration.md — co usuwamy i jak zachować dorobek.
5. acceptance.md — scenariusze i kolejność prac.
6. examples.json — małe, fikcyjne wzorce obliczeń i wyników.

Przeczytaj wszystkie pliki pakietu przed zmianą API lub bazy. Przy rozbieżności najpierw rozstrzygnij ją w dokumentach, nie implementuj jednego wariantu po cichu. Aktualne bezpośrednie polecenie właściciela ma pierwszeństwo.

## 3. Ustalenia, których nie należy ponownie projektować

- Jeden lokalny raport FE na sesję; żadnych sieciowych heartbeatów pomiarowych.
- Pytania i odpowiedzi bierze serwer ze swojej bazy. Nie ufamy kopii klucza odpowiedzi z FE.
- LLM zwraca tylko uzasadnienie oraz listę wykluczonych zadań z powodami. Nie zwraca sekund, procentów, punktów ani mnożników.
- Kod oblicza sumę unii aktywnych przedziałów pozostałych zadań, w milisekundach.
- 1 pkt/60 s; niewykorzystane milisekundy przechodzą między sesjami.
- Znikają Xbox, dzienne pakiety, saldo do wydania, punkty per zestaw i wszystkie 10 starych tabel nagród.
- Dotychczasowy ogólny dorobek i reszta pozostają; nie odejmujemy historycznie wydanych punktów.
- Szczegółowy JSONB znika po 7 dniach. Licznik profilu i krótki wynik sesji pozostają.
- Błąd LLM: zapis raportu i komunikat, bez punktów, monitoringu, alarmów, kolejki i automatycznych ponowień.
- Ponowienie dostarczenia raportu nie jest ponowną oceną. Wynik albo błąd jest jednokrotny dla sesji.
- Nie przywracaj wcześniej rozważanych limitów nagrodowych per rodzaj zadania. Aktualny model to czas FE minus zadania wskazane przez LLM.
- Samo „źle”, „wolno”, „Nie pamiętam”, pomoc albo niepewny STT nie uzasadnia wykluczenia.
- Zachowaj zmianę #101: konfigurowalny budżet sesji zestawu (domyślnie 20, zakres 1–100), snapshot budżetu i skalowany limit czasu. Nie przywracaj dawnego stałego budżetu 12 ani sztywnego limitu 10 minut.

## 4. Decyzje techniczne wykonania

Nie wymagają osobnej decyzji produktowej, dopóki mieszczą się w poniższych granicach:

- Konfiguracja oceny aktywności współdzieli istniejące `UMIEM_GRADER_BASE_URL/API_KEY/MODEL`; nowy wąski port/prompt nie używa cache `lesson_verdicts` ani limitu wywołań odpowiedzi lekcyjnych. Bez dodatkowego panelu konfiguracji.
- Termin oceny aktywności: 20 s; transport nie ma retry SDK. Przy braku konfiguracji obowiązuje uzgodniona polityka błędu.
- Wskazania zadań modelu to dokładne, zerowe `session_tasks.ordinal` wysłane w wejściu; numer widoczny w UI może być ordinal+1. Waliduj przynależność i brak duplikatów.
- Wzorzec danych FE i modelu jest w design.md. Schematy Zod w contracts po implementacji stają się autorytatywne; nie utrzymuj osobnego ręcznego schematu na serwerze.
- Małe trwałe metadane sesji przechowują fingerprint pierwszego raportu. Dzięki temu po usunięciu szczegółów identyczne dostarczenie można rozpoznać, a odmienne odrzucić, bez przechowywania treści.
- Spóźniona odpowiedź modelu nie może nadpisać zapisanego już błędu/wyniku. Sygnał deadline dotyczy finalizacji, nie tylko przerwania fetch.
- Raport nagrody nie jest częścią zamrożonych raportów wiedzy. Nie nadpisuj `context.summary`, `mockTestReport` ani `lessonMockTestReport` w celu dodania nowych punktów.
- Pełne pytania, poprawne warianty, wykluczenia i szczegółowy JSONB są wyłącznie w autoryzowanym Parent API i wejściu providera. Kid DTO dostaje tylko publiczny wynik nagrody/komunikat.
- Brak raportu oznacza brak oceny, nie dowód braku nauki. Ukończenie na innym urządzeniu bez lokalnego raportu nie rekonstruuje aktywności.
- Największa wspierana kartkówka musi zmieścić się w limicie raportu i kontekście modelu. Zwiększenie technicznego limitu po pomiarze nie może wprowadzić dodatkowych płatnych wywołań ani cichego skracania odpowiedzi.

## 5. Start w osobnym worktree

1. Wybierz zatwierdzony commit przekazania i utwórz własne worktree/gałąź implementacyjną od niego.
2. Sprawdź git status, rzeczywisty AGENTS.md i dostępność wskazanych dokumentów. Nie nadpisuj niezwiązanych zmian.
3. Sprawdź node_modules i .env. Jeżeli brakuje runtime/skilli/.env: `node scripts/setup-worktree.cjs --skip-install`.
4. Gdy node_modules istnieje i manifesty się nie zmieniają, nie instaluj zależności.
5. Gdy instalacja jest konieczna: `corepack pnpm install --prefer-offline --frozen-lockfile`, nigdy npm install.
6. Uruchom `bmad-build` z podaniem specyfikacji. Wznowienie implementacji wymaga zatwierdzonego statusu, a nie ignorowania draft.
7. Zachowaj kolejność z acceptance.md; baseline tylko celowany. Nie uruchamiaj całego monorepo/e2e przed zmianami.

## 6. Gotowy tekst zadania dla ZCode

Po zatwierdzeniu i zapisaniu commitu nadawca przekazuje poniższy tekst razem z jego pełnym SHA:

> Pracuj w osobnym worktree od przekazanego commitu planu. Uruchom bmad-build dla docs/bmad/implementation-artifacts/spec-client-reward-time.md. Przeczytaj cały pakiet client-reward-time, w tym handoff.md i examples.json. Zrealizuj zatwierdzony model raportu sesji i wykluczeń zadań przez LLM. Zachowaj punkty dzieci, usuń Xbox i 10 starych tabel. TDD RED–GREEN, adekwatne testy PostgreSQL/E2E i niezależny review. Nie wdrażaj, nie pushuj, nie scalaj do main. Jeżeli status nadal draft albo commit nie zawiera pakietu, zgłoś to przed implementacją.

Ten tekst sam nie zatwierdza draftu.

## 7. Warunki zakończenia i raport zwrotny

ZCode przekazuje:
- pełny commit bazowy/końcowy, gałąź, stan roboczy i listę zmian;
- wykonane testy wraz z wynikami; brakujące dowody oddzielnie;
- dowód, że brak aktywnych starych endpointów/importów i 10 tabel usunięto migracją na fikcyjnej bazie;
- zgodne dorobki przed/po migracji, zachowane próby/oceny i retencję bez utraty punktów;
- potwierdzenie, że LLM nie nalicza sekund/punktów, timeout nie uruchamia retry, a kid DTO nie ujawnia kluczy odpowiedzi;
- wpływ API → MCP → skill i potwierdzenie zachowania osobnego szacunku oraz vocabulary-only;
- wynik niezależnego review, nierozstrzygnięte uwagi i warunki osobnego wdrożenia.

Nie oznaczaj pracy jako gotowej tylko na podstawie testów fake providera. Jeśli brak docelowego modelu/kluczy, raportuj sprawdzone testy i brak dowodu z rzeczywistym modelem; nie wywołuj modelu na prywatnych sesjach dzieci bez osobnego uzgodnienia.
