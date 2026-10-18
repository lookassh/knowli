# Odbudowa projekcji postępu dziecka

`progress:rebuild` odtwarza projekcje dziecka z historii: `child_skill_progress` (słówka, osobno dla każdej polityki), fakty pierwszego wydania i kwalifikujących ocen, `child_target_exposures` (pierwsze/ostatnie zapieczętowane ujawnienie) oraz `child_objective_progress` (cele lekcji). Apply działa atomowo na dziecko. Domyślnie uruchamia się dry-run. Nie zmienia prób, ocen, źródłowych ekspozycji, transkrypcji, werdyktów modelu (`lesson_verdicts`, w tym decyzji rodzica), materiału ani zapisanych podsumowań.

## Przejście na projekcje `proj-3`

Migracja `0018` dodaje indeks dowodów audio. Migracja `0019` wprowadza zakres polityki i fakty potrzebne liście. Istniejące profile otrzymują `learning_projection_version=NULL`, a stare wiersze postępu pozostają w `child_skill_progress_legacy`. Nie przypisuje się im automatycznie bieżącej polityki. Ta tabela nie jest fallbackiem runtime ani kompletnym backupem bazy.

Nowe profile mają gotowy pusty stan `proj-3`. Dla istniejących wymagany jest pełny backfill przed otwarciem nowej wersji aplikacji dla użytkowników. GET nie uruchamia odbudowy. Nie wdrażać nowego kodu ze starymi writerami ani nie traktować samej migracji schematu jako zakończonej aktualizacji.

## Procedura utrzymaniowa

1. Zaplanuj okno serwisowe. Przed zatrzymaniem usług upewnij się, że nie pozostały aktywne sesje i próby `processing`; nie kończ ich automatycznie dla wygody migracji. Następnie zatrzymaj stare web oraz worker i zablokuj ruch. Odbudowa odmawia apply przy aktywnej sesji lub próbie `processing`, ale sam test tych warunków nie potwierdza zatrzymania obu usług.
2. Utwórz backup PostgreSQL i odtwórz go do osobnej bazy testowej. Zweryfikuj, że kopia zawiera historię, profile, sesje, projekcje i przypięte polityki. Nie zapisuj `DATABASE_URL` w logu ani historii poleceń.
3. W kontrolowanym procesie migracyjnym wykonaj migracje nowej wersji przy zatrzymanych writerach. Wykonują one także bootstrap polityk; nie robi tego GET listy. Użyj zgodnego obrazu/narzędzi nowej wersji do dalszych kroków. Ustaw `DATABASE_URL` przez menedżer sekretów środowiska i uruchom dry-run:

   ```sh
   pnpm --filter @learning/worker progress:rebuild
   ```

   Dry-run raportuje liczby bez słów, nazw, odpowiedzi ani sekretów. Dla jednego profilu można dodać `--child <UUID>`. Dry-run nie ustawia gotowości i nie usuwa wierszy legacy. Nie dodawaj osobnego separatora `--` po nazwie skryptu pnpm: istniejący parser otrzymałby go jako nieobsługiwany argument.
4. Sprawdź raport i spełnienie warunków apply. Jeśli pozostała aktywna sesja lub przetwarzana próba, nie omijaj zabezpieczenia SQL. Wróć do kontrolowanej procedury poprzedniej wersji albo przerwij aktualizację i wycofaj ją według procedury poniżej.
5. Uruchom apply dla jednego profilu lub wszystkich:

   ```sh
   pnpm --filter @learning/worker progress:rebuild --child <UUID> --apply
   pnpm --filter @learning/worker progress:rebuild --apply
   ```

6. Apply ustawia gotowość profilu dopiero po kompletnym odtworzeniu i usuwa jego kopię legacy w tej samej transakcji. Przerwane wykonanie nie może oznaczyć nieukończonego profilu jako gotowego; już ukończone profile można ponownie bezpiecznie odbudować. Uruchom dry-run ponownie: oczekiwane `inserted: 0`, `updated: 0`, `deleted: 0`. Weryfikację gotowości wykonaj przez kontrolowane połączenie administracyjne, bez wypisywania danych profili:

   ```sql
   SELECT count(*) AS profiles_not_ready
   FROM learning_app.child_profiles
   WHERE learning_projection_version IS DISTINCT FROM 'proj-3';

   SELECT count(*) AS legacy_rows
   FROM learning_app.child_skill_progress_legacy;
   ```

   Oba wyniki po pełnym backfillu mają wynosić zero. Pusta tabela legacy pozostaje jawnie zamodelowana; jej ewentualne usunięcie wymaga późniejszej migracji.
7. Uruchom zgodne wersje web i worker, wykonaj smoke test listy, wznowienia/startu sesji oraz raportu rodzica i dopiero wtedy przywróć ruch. Zmierz rozgrzany GET listy osobno od startu procesu/kompilacji; porównaj medianę i p95 z baseline na tej samej trasie. Benchmark lokalny nie jest potwierdzeniem czasu produkcyjnego.

## Wycofanie

Samo cofnięcie obrazu nie jest rollbackiem po zmianie klucza i nazw tabel. Zatrzymaj web i worker, zachowaj diagnostycznie obecną bazę, odtwórz pełny backup sprzed migracji do osobnej bazy i sprawdź jego historię, projekcje i zgodność ze starą wersją kodu. Dopiero potem przełącz zatrzymane usługi na odtworzoną bazę i zgodny obraz. Nie przywracaj częściowych tabel do działającej bazy. Jeżeli po aktualizacji przyjęto nowe odpowiedzi, nie przełączaj bez uzgodnienia ich zachowania: przywrócenie starszego backupu utraciłoby te zapisy.

## API i integracje

Optymalizacja zachowuje endpointy i publiczne DTO. Zakres polityki jest jawny wewnątrz projekcji; raport rodzica zachowuje wybór ostatniej wiarygodnej oceny. `learning-overview` i skill Hermesa nadal wykluczają lekcje. Po aktualizacji sprawdź regresje raportów i kontraktu; jeśli zmieni się znaczenie pól lub obsługa błędów integracji, wymagane są odpowiednie zmiany API → MCP → skill. Sama zmiana kodu nie aktualizuje zainstalowanego skilla u konsumenta.

Testy integracyjne używają osobnej bazy PostgreSQL i sztucznych profili. Nie uruchamiaj ich ani procedury serwisowej na rodzinnej bazie.
