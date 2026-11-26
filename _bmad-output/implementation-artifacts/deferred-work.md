- source_spec: `_bmad-output/implementation-artifacts/spec-gh-404-long-answer-not-graded.md`
  summary: Kid UI pozwala wpisać 600 znaków w lekcjach spoza szkoły, choć grader ocenia tam do 200; dziecko dostaje ogólne „Nie udało się ocenić” i może powtarzać ten sam tekst — limit 200 w polu albo komunikat „Napisz krócej”.
  evidence: LessonSentenceView.tsx maxLength = MAX_TEXT_ATTEMPT_LENGTH (600); po #404 odpowiedź >200 znaków poza szkołą i rozsypanką jest `not_assessed` z powodem `answer_too_long`. Właściciel zdecydował 2026-11-25: odłożyć.
- source_spec: `_bmad-output/implementation-artifacts/spec-gh-404-long-answer-not-graded.md`
  summary: W `lesson_verdicts` mogą zostać werdykty sprzed #404 policzone z 200-znakowego prefiksu, a zapisane pod kluczem pełnej odpowiedzi; widać je w recenzji werdyktów rodzica.
  evidence: nowa gałąź pomija odczyt cache dla zbyt długich odpowiedzi, ale nie usuwa starych wierszy; skalę można sprawdzić zapytaniem `length(normalized_answer) > 200` na produkcji (nie sprawdzone).
