# Odbudowa projekcji postępu dziecka

`progress:rebuild` odtwarza projekcje postępu dziecka z jego własnej, wiarygodnej historii ocen: zarówno `child_skill_progress` (słówka), jak i `child_objective_progress` (cele lekcji) — w jednym przejściu, w jednej transakcji na dziecko. Domyślnie działa jako dry-run. Nie zmienia prób, ocen, ekspozycji, transkrypcji, werdyktów modelu (`lesson_verdicts`, w tym decyzji rodzica), materiału ani zapisanych podsumowań.

## Procedura utrzymaniowa

1. Zaplanuj okno serwisowe i zatrzymaj web oraz worker. Odbudowa odmawia pracy przy aktywnej sesji lub próbie `processing`, ale sam test tych warunków nie potwierdza zatrzymania obu usług.
2. Utwórz backup PostgreSQL i odtwórz go do osobnej bazy testowej. Zweryfikuj, że kopia zawiera historię, profile, sesje, projekcje i przypięte polityki. Nie zapisuj `DATABASE_URL` w logu ani historii poleceń.
3. Ustaw `DATABASE_URL` przez menedżer sekretów środowiska i uruchom dry-run:

   ```sh
   pnpm --filter @learning/worker progress:rebuild
   ```

   Dry-run raportuje liczbę profili i projekcji (słówka i cele łącznie) bez słów, nazw, odpowiedzi ani sekretów. Dla jednego profilu można dodać `--child <UUID>`. Odbudowa odmawia pracy przy aktywnej sesji lub próbie `processing` dziecka — te same blokady i odmowy obejmują cele lekcji, bo słówka i cele odbudowują się w jednej transakcji na dziecko (jedno przejście, bez przełącznika zakresu).
4. Sprawdź raport oraz stan profilu. Jawnie zakończ aktywną sesję w aplikacji, jeśli jeszcze istnieje, i ponownie sprawdź, że usługi są zatrzymane.
5. Uruchom apply dla jednego profilu lub wszystkich:

   ```sh
   pnpm --filter @learning/worker progress:rebuild -- --child <UUID> --apply
   pnpm --filter @learning/worker progress:rebuild -- --apply
   ```

6. Uruchom dry-run ponownie. Powinien pokazać `inserted: 0`, `updated: 0` i `deleted: 0`. Zweryfikuj liczbę projekcji, rekomendacje zestawu i raport postępu w aplikacji.
7. Uruchom ponownie web i worker, a następnie sprawdź zdrowie aplikacji i możliwość rozpoczęcia nowej sesji.

## Wycofanie

Samo cofnięcie kodu nie przywraca starych projekcji. Jeśli weryfikacja po apply wykryje problem, zatrzymaj web i worker, odtwórz backup do nowej bazy, sprawdź historię i projekcje, a dopiero potem przełącz usługę na odtworzoną bazę. Nie przywracaj częściowych tabel z backupu do działającej bazy.

Testy integracyjne używają osobnej bazy PostgreSQL i sztucznych profili. Nie uruchamiaj ich ani procedury serwisowej na rodzinnej bazie.
