# Projekt: Knowli

**Nazwa dla użytkownika:** Umiem!\
**Stan projektu:** istniejąca aplikacja typu brownfield; inicjalizacja planowania operacyjnego\
**Ostatnia aktualizacja:** 2026-10-21

## Co to jest

Knowli (w interfejsie **Umiem!**) to prywatna, self-hostowana aplikacja rodzinna do nauki. Rodzic przygotowuje temat lub materiał, AI może przygotować propozycję, a rodzic ją sprawdza i zatwierdza. Dziecko uczy się w krótkich sesjach, zaś aplikacja zapisuje próby i trudności osobno dla każdego dziecka oraz umiejętności.

Pierwszy moduł jest przeznaczony do nauki podstawowego słownictwa angielskiego przez polskojęzyczne dziecko. Interfejs rodzica i dziecka jest po polsku (`pl-PL`); materiał startowy używa pary `pl-PL` → `en-GB`.

## Najważniejsza wartość

Rodzic może zatwierdzić materiał dopasowany do dziecka, a dziecko może przejść krótką sesję także bez mikrofonu; historia musi wiarygodnie odróżniać wyniki poszczególnych umiejętności i rzeczywiste trudności od błędów technicznych.

## Bieżący stan

To nie jest projekt od zera. Mapa kodu z 2026-10-21 oraz bieżące źródła wskazują, że repozytorium ma już modularny monolit z aplikacją rodzica, przenośnym Kid UI, API, workerem, kontraktami, bazą PostgreSQL/Drizzle, migracjami, testami i integracją MCP. W kodzie istnieją też przepływy materiałów słownictwa, sesji, historii, postępu, lekcji i raportowania.

Ta inicjalizacja **nie poświadcza uruchomionego środowiska ani aktualnego wyniku testów**. Historyczne wyniki w dokumentach i obecność kodu są dowodem zakresu implementacji, ale nie zastępują ponownego odbioru na docelowym wdrożeniu. Aktualna mapa wskazuje trzy pozostałe luki dowodowe: pełny smoke Compose z restartem, odtworzenie backupu oraz próby na rzeczywistym urządzeniu i rzeczywistej mowie dziecka.

## Udokumentowana baza produktu

Poniższe wymagania pochodzą przede wszystkim z `docs/SPEC.md` i są wspierane przez aktualną mapę kodu. Są tłem dla roadmapy, a nie nowymi funkcjami zaplanowanymi do zbudowania.

| Zakres udokumentowany | Sygnał w aktualnym repozytorium | Status w tym planie |
| --- | --- | --- |
| Rodzic zarządza profilami, szkicami, zatwierdzaniem i przypisaniem materiału. | Parent API/UI oraz moduły profili i zestawów. | Wdrożenie wskazane przez kod; aktualny odbiór środowiska niezweryfikowany. |
| Dziecko prowadzi sesję słownictwa z zapisem ekspozycji, prób i postępu per umiejętność. | Kid API/UI, moduły sessions/attempts/reporting i testy integracyjne. | Wdrożenie wskazane przez kod; aktualny odbiór urządzenia niezweryfikowany. |
| Pełna ścieżka bez mikrofonu pozostaje użyteczna. | Zadania pisemne i rozpoznawanie, obsługa odmowy mikrofonu oraz przenośne adaptery mediów. | Wymaga odbioru na urządzeniu w aktywnym zakresie. |
| Mowa rozdziela rozpoznanie treści od oceny wymowy i nie zachowuje surowego audio. | Porty oraz adaptery STT/wymowy, polityki i testy fake-providerów. | Wymaga próby z realnym providerem i nagraniem dziecka przed deklaracją jakości. |

## Aktywny zakres tego cyklu

Ten cykl nie powtarza budowy powyższych możliwości. Zamienia istniejącą implementację w potwierdzony, prywatnie uruchamialny produkt rodzinny:

1. Prywatne wdrożenie, migracje i restart dają sprawny, trwały stos web + worker + PostgreSQL.
2. Backup można odtworzyć do pustej instancji razem z profilami, zatwierdzonym materiałem, historią i mediami.
3. Rodzic zatwierdza materiał, a dziecko kończy sesję 5–10 minut na rzeczywistym telefonie lub tablecie bez mikrofonu.
4. Rodzic widzi wynik tej pracy osobno dla dziecka i umiejętności; zachowane są różnice między samodzielną odpowiedzią, wsparciem i brakiem oceny.
5. Gdy włączona jest ścieżka mowy, jej ograniczenia i progi są potwierdzone na prawdziwym urządzeniu, bez fałszywego przypisywania błędu dziecku.

## Ograniczenia

- Pozostaje modularny monolit: Next.js App Router/React/strict TypeScript i Node.js, PostgreSQL/Drizzle, pnpm workspaces oraz oddzielny proces workera na tej samej bazie. Nie dodajemy mikroserwisów, Redis ani osobnego backendu.
- `packages/contracts` jest publiczną granicą DTO i Zod. Kid UI używa jawnego `/api/v1/kid` i konfigurowalnego `baseUrl`, bez importów Next.js, bazy lub Server Actions.
- Opublikowany materiał jest niezmienny; edycja tworzy szkic/nową wersję, a aktywna sesja ma przypiętą treść i politykę.
- Historia prób i ekspozycji jest źródłem prawdy. Projekcje postępu są odtwarzalne; stary wynik nie może awansować unieważnionej umiejętności.
- Nagranie dziecka jest krótkotrwałe: nie trafia do bazy, kolejki, plików, logów, fixture ani backupu.
- Rodzic jest chroniony PIN-em/hasłem i autoryzacją serwerową. Wybór profilu dziecka nie jest mechanizmem zabezpieczenia publicznej instancji.
- Zmiana kontraktu API wymaga oceny wpływu na MCP, wygenerowany schemat i `integrations/umiem-mcp/skills/umiem-learning/SKILL.md`.
- Interfejs pozostaje po polsku, mobile first i dostępny. Błąd techniczny, cisza, pominięcie lub niepewne STT nie są błędem wiedzy dziecka.

## Poza zakresem

| Element | Powód |
| --- | --- |
| Publiczne wystawienie aplikacji lub wielorodzinna platforma | Kid API zakłada zaufaną prywatną instalację; brama dostępu wymaga osobnej decyzji. |
| Natywna aplikacja Android/iOS | Przenośne Kid UI przygotowuje grunt, ale obecny produkt jest web/PWA. |
| OCR/PDF, podręczniki, chat/awatar AI, rozmowy realtime | Nie wspierają obecnie podstawowej rodzinnej ścieżki materiał → zatwierdzenie → krótka sesja. |
| OAuth, marketplace, płatności, social/rankingi i rozbudowana gamifikacja | Nie należą do prostego, prywatnego MVP. |
| Pełna synchronizacja offline | PWA nie ma obiecywać lokalnych sukcesów bez połączenia z serwerem. |
| Skalowanie na wiele instancji web/worker | Obecne ograniczenia bezpieczeństwa i pracy workera zakładają pojedynczą prywatną instalację. |

## Kluczowe decyzje

| Decyzja | Uzasadnienie | Status |
| --- | --- | --- |
| Rodzic zatwierdza materiał przed nauką dziecka. | AI przygotowuje propozycję, nie publikuje samodzielnie. | Obowiązuje |
| Samodzielne przypominanie, rozpoznawanie, wymowa i pisownia są osobne. | Jeden poprawny wynik nie oznacza opanowania wszystkich umiejętności. | Obowiązuje |
| Ścieżka bez mikrofonu jest pełnoprawna. | Zgoda na mikrofon i jakość STT nie mogą blokować nauki. | Obowiązuje |
| Dostawcy AI i mowy są adapterami za portami. | Domena ma pozostać niezależna od Azure/OpenAI. | Obowiązuje |
| Dostęp pozostaje prywatny i pojedynczo instalowany. | Przed publicznym udostępnieniem potrzebna jest odrębna brama dostępu. | Obowiązuje |
| Aktualna roadmapa jest walidacją operacyjną, nie ponowną implementacją MVP. | Funkcje są już obecne w mapie kodu; brakuje bieżących dowodów środowiskowych. | Obowiązuje |

## Evolution

Po każdym etapie aktualizuj wymagania, dowody walidacji i nierozstrzygnięte ograniczenia. Nie przenoś historycznego wyniku testu ani samej obecności kodu do statusu „zweryfikowane” bez aktualnego, odtwarzalnego dowodu.
