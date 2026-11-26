---
status: done
---

# gh-395: informacja o usłudze generującej słówka

## Intent

Opis rodzica przy generowaniu zestawu słówek (z opisu i ze źródła) trafia do modelu `UMIEM_LLM`, a gotowe słowa do usług nagrań i obrazków. Panel ma to mówić tak jak formularz lekcji (`serviceInfo.generation`).

## Design Notes

- Słówka generuje `UMIEM_LLM` (`createGenerationDepsFromEnv` → `llm`), a katalog lekcji już niesie jego etykietę `SubjectCatalogDto.generationService` (`generationPublicServiceFromEnv`). Zamiast nowego pola DTO rozszerzono opis istniejącego — ten sam byt, bez zmiany schematu, bez wpływu na MCP (`SubjectCatalogDto` nie należy do kontraktu `/api/mcp`).
- `DeckGenerationServiceNote` czyta `orpc.lessonCatalog.get` (ten sam klucz zapytania co formularz lekcji i strona źródła) i renderuje linię jak lekcje (`Text size="sm" .pp-editor-muted`); bez etykiety lub przed wczytaniem — nic.
- Bez nazw kosztów; nazwa `host · model` jak w lekcjach.

## Tasks & Acceptance

- [x] `messages.decks.generationServiceInfo`
- [x] `apps/web/src/parent/DeckGenerationServiceNote.tsx`, użyty w `NewMaterialDialog` (krok generate) i `NewVocabularyForm`
- [x] Given katalog z `generationService`, When krok generowania/ze źródła, Then linia z nazwą usługi (`deck-generation-service.test.tsx`, E2E `parent-flow.spec.ts` z `fake-llm-1`)
- [x] Given brak etykiety lub katalog niewczytany, Then brak linii

## Auto Run Result

Status: done
