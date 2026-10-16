# Spójność wielkości liter w rozpoznawaniu mowy i ocenie wymowy — projekt

Data: 2026-10-16. Worktree: `ignore_pronunciation_case`.

## Kontekst i problem

Podczas ćwiczeń mowy (`speech` oraz `picture_recall` z mikrofonem) dziecko wypowiada słowo w języku angielskim, np. kolor *purple*.
Usługa transkrypcji mowy (Azure Speech-to-Text w trybie `format=detailed`) zwraca pole `DisplayText`, które formatuje wypowiedź jak początek zdania pisanego, z wielką literą na początku i kropką na końcu (np. `"Purple."`).

Funkcja czyszcząca `normalizeSpokenAnswerText` obcinała brzegową interpunkcję, pozostawiając wielką literę (`"Purple"`). W module `speech.ts` wartość ta trafiała bezpośrednio do `recognizedText` (a stamtąd do `heardText` na karcie feedbacku `SpeechFeedbackCard` w Kid UI), podczas gdy oczekiwany wzorzec słowa w zestawie to `"purple"`.

Gdy próba mowy uzyskała ocenę częściową (`band: "partial"`, np. wynik w przedziale 50–69 pkt ze względu na trudniejszą dla polskich dzieci samogłoskę nurse */ɜː/*), karta feedbacku wyświetlała:
- **Usłyszałem: Purple**
- **Prawie! Posłuchaj jeszcze raz**
- **Wzorzec: purple**

Dla dziecka i rodzica komunikat ten wyglądał tak, jakby aplikacja odrzuciła wypowiedź ze względu na wielką literę („wymówiłeś Purple, a powinno być purple”), podczas gdy w mowie wielkość liter w ogóle nie istnieje.

Ponadto w module `speech.ts` występowały ścisłe porównania `match.matchedVariant === key.target` oraz `p.expectedText !== match.matchedVariant`, które przy rozbieżności wielkości liter między wariantami mogłyby pominąć ocenę wymowy.

## Wymagania i cele

1. **Spójność wielkości liter w `heardText` / `recognizedText`**:
   - Gdy mowa dziecka pasuje do kanonicznego celu lub zatwierdzonego wariantu (`match.ci`), `recognizedText` musi przyjąć dokładnie taką wielkość liter, jaką ma dopasowany wariant (`match.matchedVariant`), np. `"purple"` dla purple, `"Monday"` dla Monday.
   - Gdy mowa dziecka nie pasuje do wariantów (`different`), ale oczekiwane słowo zaczyna się małą literą (nie jest nazwą własną), rozpoznany tekst nie powinien narzucać wielkiej litery z początku zdania STT (np. `"turtle"` zamiast `"Turtle"` przy oczekiwanym `"purple"`).
2. **Niezawodność oceny wymowy**:
   - Porównania `match.matchedVariant` z `key.target` oraz `p.expectedText` z `match.matchedVariant` muszą być odporne na wielkość liter (`.toLowerCase()`), aby żaden dopasowany wariant nie został potraktowany jako `not_applicable` lub `unevaluated` z powodu różnicy wielkości liter.
3. **Prywatność i brak regresji**:
   - Brak zapisu surowego audio i logowania danych osobowych dziecka.
   - Wszystkie istniejące kontrakty DTO, ekspozycje celów oraz testy integracyjne mowy pozostają w 100% zgodne.
