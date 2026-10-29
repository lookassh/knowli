/**
 * Czysty stan wyboru pojęć kluczowych (`lesson_keywords`): dotknięcie
 * zaznacza albo odznacza pojęcie; ponad `maxSelected` nic nie dochodzi
 * (odznaczenie zawsze działa). Kolejność wyboru nie ma znaczenia dla oceny.
 */
export function toggleKeyword(selected: readonly string[], optionId: string, maxSelected: number): readonly string[] {
  if (selected.includes(optionId)) return selected.filter((id) => id !== optionId);
  if (selected.length >= maxSelected) return selected;
  return [...selected, optionId];
}
