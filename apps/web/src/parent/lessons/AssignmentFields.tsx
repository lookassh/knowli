import { messages, MAX_GROUP_ITEMS, MAX_GROUPS, MAX_MATCH_EXTRA, MAX_MATCH_PAIRS, MIN_GROUPS, MIN_MATCH_PAIRS, MIN_GROUP_ITEMS } from "@learning/contracts";
import { groupAnswerOf, matchAnswerOf, nextGroupId, type EditableLessonExercise } from "./lesson-editor-state";

type Patch = Partial<EditableLessonExercise>;

/**
 * Edycja par (`lesson_match`) i grup (`lesson_group`) — design szkoły §10.6.
 * Odpowiedź wzorcowa wynika z pól, więc każda zmiana przelicza ją od razu.
 */
export default function AssignmentFields({ exercise, index, disabled, onChange }: {
  exercise: EditableLessonExercise;
  index: number;
  disabled: boolean;
  onChange: (patch: Patch) => void;
}) {
  const t = messages.lessons;
  if (exercise.exerciseType === "lesson_match") {
    const pairs = exercise.pairs ?? [];
    const extra = exercise.extraRight ?? [];
    const setPairs = (next: { left: string; right: string }[]) => onChange({ pairs: next, answer: matchAnswerOf({ pairs: next }) });
    return (
      <fieldset data-testid={`pairs-${index}`}>
        <legend>{t.pairsLegend}</legend>
        {pairs.map((pair, pi) => (
          <div key={pi} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input data-testid={`pair-left-${index}-${pi}`} value={pair.left} disabled={disabled} maxLength={40}
              aria-label={t.pairLeftLabel.replace("{n}", String(pi + 1))}
              onChange={(e) => setPairs(pairs.map((p, i) => (i === pi ? { ...p, left: e.target.value } : p)))} />
            <span aria-hidden="true">→</span>
            <input data-testid={`pair-right-${index}-${pi}`} value={pair.right} disabled={disabled} maxLength={100}
              aria-label={t.pairRightLabel.replace("{n}", String(pi + 1))}
              onChange={(e) => setPairs(pairs.map((p, i) => (i === pi ? { ...p, right: e.target.value } : p)))} />
            {pairs.length > MIN_MATCH_PAIRS && (
              <button type="button" data-testid={`pair-remove-${index}-${pi}`} disabled={disabled}
                onClick={() => setPairs(pairs.filter((_, i) => i !== pi))}>{t.removeRow}</button>
            )}
          </div>
        ))}
        {pairs.length < MAX_MATCH_PAIRS && (
          <button type="button" data-testid={`pair-add-${index}`} disabled={disabled}
            onClick={() => setPairs([...pairs, { left: "", right: "" }])}>{t.pairAdd}</button>
        )}
        <p className="muted">{t.extraRightHint}</p>
        {extra.map((text, xi) => (
          <div key={xi} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input data-testid={`extra-right-${index}-${xi}`} value={text} disabled={disabled} maxLength={100}
              aria-label={t.extraRightLabel.replace("{n}", String(xi + 1))}
              onChange={(e) => onChange({ extraRight: extra.map((v, i) => (i === xi ? e.target.value : v)) })} />
            <button type="button" data-testid={`extra-right-remove-${index}-${xi}`} disabled={disabled}
              onClick={() => onChange({ extraRight: extra.filter((_, i) => i !== xi) })}>{t.removeRow}</button>
          </div>
        ))}
        {extra.length < MAX_MATCH_EXTRA && (
          <button type="button" data-testid={`extra-right-add-${index}`} disabled={disabled}
            onClick={() => onChange({ extraRight: [...extra, ""] })}>{t.extraRightAdd}</button>
        )}
      </fieldset>
    );
  }
  if (exercise.exerciseType === "lesson_group") {
    const groups = exercise.groups ?? [];
    const items = exercise.groupItems ?? [];
    const setGroups = (next: { id: string; label: string }[], nextItems = items) =>
      onChange({ groups: next, groupItems: nextItems, answer: groupAnswerOf({ groups: next }) });
    return (
      <fieldset data-testid={`groups-${index}`}>
        <legend>{t.groupsLegend}</legend>
        {groups.map((group, gi) => (
          <div key={group.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input data-testid={`group-label-${index}-${gi}`} value={group.label} disabled={disabled} maxLength={30}
              aria-label={t.groupLabelLabel.replace("{n}", String(gi + 1))}
              onChange={(e) => setGroups(groups.map((g) => (g.id === group.id ? { ...g, label: e.target.value } : g)))} />
            {groups.length > MIN_GROUPS && (
              <button type="button" data-testid={`group-remove-${index}-${gi}`} disabled={disabled}
                onClick={() => setGroups(groups.filter((g) => g.id !== group.id), items.filter((item) => item.groupId !== group.id))}>{t.removeRow}</button>
            )}
          </div>
        ))}
        {groups.length < MAX_GROUPS && (
          <button type="button" data-testid={`group-add-${index}`} disabled={disabled}
            onClick={() => setGroups([...groups, { id: nextGroupId(groups), label: "" }])}>{t.groupAdd}</button>
        )}
        <p className="muted">{t.groupItemsHint}</p>
        {items.map((item, ii) => (
          <div key={ii} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input data-testid={`group-item-${index}-${ii}`} value={item.text} disabled={disabled} maxLength={40}
              aria-label={t.groupItemLabel.replace("{n}", String(ii + 1))}
              onChange={(e) => onChange({ groupItems: items.map((it, i) => (i === ii ? { ...it, text: e.target.value } : it)) })} />
            <select data-testid={`group-item-group-${index}-${ii}`} value={item.groupId} disabled={disabled}
              aria-label={t.groupItemGroupLabel.replace("{n}", String(ii + 1))}
              onChange={(e) => onChange({ groupItems: items.map((it, i) => (i === ii ? { ...it, groupId: e.target.value } : it)) })}>
              {groups.map((group, gi) => <option key={group.id} value={group.id}>{group.label || t.groupLabelLabel.replace("{n}", String(gi + 1))}</option>)}
            </select>
            {items.length > MIN_GROUP_ITEMS && (
              <button type="button" data-testid={`group-item-remove-${index}-${ii}`} disabled={disabled}
                onClick={() => onChange({ groupItems: items.filter((_, i) => i !== ii) })}>{t.removeRow}</button>
            )}
          </div>
        ))}
        {items.length < MAX_GROUP_ITEMS && groups.length > 0 && (
          <button type="button" data-testid={`group-item-add-${index}`} disabled={disabled}
            onClick={() => onChange({ groupItems: [...items, { text: "", groupId: groups[0]!.id }] })}>{t.groupItemAdd}</button>
        )}
      </fieldset>
    );
  }
  return null;
}
