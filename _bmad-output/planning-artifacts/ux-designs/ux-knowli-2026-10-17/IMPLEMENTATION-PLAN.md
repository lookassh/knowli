# Wdrożenie wariantu A — plan

Data: 2026-10-17. Status: przygotowany; kod aplikacji bez zmian. Właściciel wybrał wariant A. Wcześniejsze polecenie „Niczego jeszcze nie implementuj” nadal obowiązuje.

## Wynik

Ćwiczenie wyboru obrazka korzysta z szerokości telefonu, pokazuje jednoznaczne wyniki i zachowuje stałą geometrię. Desktop otrzymuje większą, wyśrodkowaną siatkę z limitem szerokości. Pełne ilustracje bez kadrowania; 2×2, bez widocznych podpisów. Kontrakty UX: DESIGN.md i EXPERIENCE.md.

## Kolejność

1. **Przekazanie do `bmad-build`.** To jedna spójna zmiana Kid UI. Przed edycją sprawdzić świeży `origin/main`, lokalne zmiany i dokumenty UX; użyć osobnej gałęzi. Nie ma potrzeby tworzenia nowego PRD ani pełnego planu sprintu.
2. **Dopasowanie ramy ćwiczenia.** W `PictureListeningView.tsx` i `styles.css` oprzeć wymiary na dostępnej szerokości oraz wysokości. Zachować kwadraty, limit desktop 560 px i stałe sloty. W `ExerciseFrame.tsx` ewentualną zmianę lokalizować do ćwiczenia obrazkowego. Wynik i akcję umieścić przy siatce; uwzględnić niskie okna, safe areas, zoom i przewijanie awaryjne.
3. **Wynik i dostępność.** Jawne znaczniki ✓/× na pełnym tle, ramka 4 px, brak przygaszenia utrudniającego rozpoznanie. Powiązać wynik z wybraną opcją i rozwiązaniem wyłącznie na podstawie istniejącego feedbacku serwera. Sprawdzić `option-outcome.ts`, `LearnScreen.tsx` i `AnswerFeedback.tsx`. Wynik nie może zmieniać miejsca kafelków. Teksty statyczne w `packages/contracts/src/messages.ts`; retry/dalej według stanu sesji. Zachować dotychczasowe funkcje globalnego sterowania dźwiękiem — makieta upraszcza pasek, nie rozstrzyga jego semantyki.
4. **Weryfikacja.** Przed zmianą szybki test związany z modułem; potem celowane testy stanów wyniku i geometrii, E2E `picture-choice-layout.spec.ts` / `picture-vocabulary.spec.ts`, typecheck i build. Dobierać regresje do faktycznego zakresu, poszerzać sprawdzenia przy zmianie współdzielonej ramy. Bez instalacji zależności, gdy istnieje `node_modules` i lockfile pozostaje bez zmian.
5. **Review i odbiór.** Review zmiany w ramach `bmad-build`, poprawa istotnych uwag. Pokazać zrzuty gotowej aplikacji w stanach gotowości, trafienia i pomyłki na mobile oraz desktopie. Odbiór na rzeczywistym telefonie/PWA osobno, na podstawie rzeczywistej próby. Raport oddziela wyniki testów od potwierdzenia na urządzeniu.

## Kryteria odbioru

- W typowym pionowym viewporcie 360×640, 390×844 i 412×915 CSS px wszystkie opcje, krótki wynik i główna akcja mieszczą się bez przewijania całej strony.
- Siatka wykorzystuje szerokość pomiędzy marginesami, chyba że ogranicza ją dostępna wysokość. Kafelki są kwadratowe i nie rozciągają ani nie kadrują ilustracji.
- Trzy opcje zachowują A B / C, cztery A B / C D; desktop do 560 px szerokości siatki.
- Czytelne ✓/× oraz różne kształty znaczników pozwalają rozpoznać stan bez polegania na kolorze. Kontrast jest mierzony na rzeczywistych tłach w obu motywach.
- Po błędzie widać wybór dziecka i ujawnione rozwiązanie, bez komunikatu sugerującego poprawną odpowiedź dziecka.
- Oczekiwanie, wynik i ponowienie tego samego zadania nie przesuwają opcji ani akcji przy niezmienionym viewporcie.
- Przy offline lub awarii brak lokalnego sukcesu, pomyłki wiedzy i nieautoryzowanego rozwiązania.
- Klawiatura, nazwy dostępne, fokus i ogłoszenie wyniku działają; przy zoomie 200% i małej wysokości treść i akcje pozostają osiągalne.
- Sprawdzone również: tablet 768×1024, desktop 1366×768 i 1920×1080, orientacja 844×390; 2/3/4 opcje i oba motywy.
- API → MCP → skill: jeżeli wdrożenie pozostaje zmianą prezentacji, odnotować brak wpływu. Każdą faktyczną zmianę kontraktu ponownie ocenić zgodnie z AGENTS.md.

## Zakończenie

Po poleceniu implementacji wykonać plan przez `bmad-build`. Sposób publikacji i zakończenia pracy w Git uzgodnić zgodnie z Policy repozytorium; niniejszy dokument nie upoważnia do push do main ani merge PR.
