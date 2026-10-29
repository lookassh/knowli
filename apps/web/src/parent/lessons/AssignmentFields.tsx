import { Button, Group, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import { messages, MAX_GROUP_ITEMS, MAX_GROUPS, MAX_MATCH_EXTRA, MAX_MATCH_PAIRS, MIN_GROUPS, MIN_MATCH_PAIRS, MIN_GROUP_ITEMS } from "@learning/contracts";
import { groupAnswerOf, matchAnswerOf, nextGroupId, type EditableLessonExercise } from "./lesson-editor-state";

type Patch = Partial<EditableLessonExercise>;

function RemoveButton({ testId, disabled, onClick }: { testId: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button size="md" variant="subtle" color="red" data-testid={testId} disabled={disabled} onClick={onClick}>
      {messages.lessons.removeRow}
    </Button>
  );
}

function AddButton({ testId, disabled, label, onClick }: { testId: string; disabled: boolean; label: string; onClick: () => void }) {
  return (
    <Button size="md" variant="light" className="pp-lesson-start" data-testid={testId} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}

/**
 * Edycja par (`lesson_match`) i grup (`lesson_group`) — design szkoły §10.6.
 * Odpowiedź wzorcowa wynika z pól, więc każda zmiana przelicza ją od razu.
 * Wiersze pole + przycisk zawijają się na wąskim ekranie (karta ćwiczenia, faza 6b).
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
      <fieldset className="pp-lesson-fieldset pp-lesson-wide" data-testid={`pairs-${index}`}>
        <legend>{t.pairsLegend}</legend>
        <Stack gap="xs">
          {pairs.map((pair, pi) => (
            <Group key={pi} gap="xs" align="center">
              <TextInput size="md" className="pp-lesson-grow" data-testid={`pair-left-${index}-${pi}`} value={pair.left} disabled={disabled} maxLength={40}
                aria-label={t.pairLeftLabel.replace("{n}", String(pi + 1))}
                onChange={(e) => {
                  const left = e.currentTarget.value;
                  setPairs(pairs.map((p, i) => (i === pi ? { ...p, left } : p)));
                }} />
              <Text aria-hidden="true">→</Text>
              <TextInput size="md" className="pp-lesson-grow" data-testid={`pair-right-${index}-${pi}`} value={pair.right} disabled={disabled} maxLength={100}
                aria-label={t.pairRightLabel.replace("{n}", String(pi + 1))}
                onChange={(e) => {
                  const right = e.currentTarget.value;
                  setPairs(pairs.map((p, i) => (i === pi ? { ...p, right } : p)));
                }} />
              {pairs.length > MIN_MATCH_PAIRS && (
                <RemoveButton testId={`pair-remove-${index}-${pi}`} disabled={disabled} onClick={() => setPairs(pairs.filter((_, i) => i !== pi))} />
              )}
            </Group>
          ))}
          {pairs.length < MAX_MATCH_PAIRS && (
            <AddButton testId={`pair-add-${index}`} disabled={disabled} label={t.pairAdd} onClick={() => setPairs([...pairs, { left: "", right: "" }])} />
          )}
          <Text size="sm" className="pp-editor-muted">{t.extraRightHint}</Text>
          {extra.map((text, xi) => (
            <Group key={xi} gap="xs">
              <TextInput size="md" className="pp-lesson-grow" data-testid={`extra-right-${index}-${xi}`} value={text} disabled={disabled} maxLength={100}
                aria-label={t.extraRightLabel.replace("{n}", String(xi + 1))}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  onChange({ extraRight: extra.map((v, i) => (i === xi ? value : v)) });
                }} />
              <RemoveButton testId={`extra-right-remove-${index}-${xi}`} disabled={disabled} onClick={() => onChange({ extraRight: extra.filter((_, i) => i !== xi) })} />
            </Group>
          ))}
          {extra.length < MAX_MATCH_EXTRA && (
            <AddButton testId={`extra-right-add-${index}`} disabled={disabled} label={t.extraRightAdd} onClick={() => onChange({ extraRight: [...extra, ""] })} />
          )}
        </Stack>
      </fieldset>
    );
  }
  if (exercise.exerciseType === "lesson_group") {
    const groups = exercise.groups ?? [];
    const items = exercise.groupItems ?? [];
    const setGroups = (next: { id: string; label: string }[], nextItems = items) =>
      onChange({ groups: next, groupItems: nextItems, answer: groupAnswerOf({ groups: next }) });
    return (
      <fieldset className="pp-lesson-fieldset pp-lesson-wide" data-testid={`groups-${index}`}>
        <legend>{t.groupsLegend}</legend>
        <Stack gap="xs">
          {groups.map((group, gi) => (
            <Group key={group.id} gap="xs">
              <TextInput size="md" className="pp-lesson-grow" data-testid={`group-label-${index}-${gi}`} value={group.label} disabled={disabled} maxLength={30}
                aria-label={t.groupLabelLabel.replace("{n}", String(gi + 1))}
                onChange={(e) => {
                  const label = e.currentTarget.value;
                  setGroups(groups.map((g) => (g.id === group.id ? { ...g, label } : g)));
                }} />
              {groups.length > MIN_GROUPS && (
                <RemoveButton testId={`group-remove-${index}-${gi}`} disabled={disabled} onClick={() => {
                  // Elementy usuwanej grupy przechodzą do pierwszej pozostałej — rodzic ich nie traci.
                  const remaining = groups.filter((g) => g.id !== group.id);
                  setGroups(remaining, items.map((item) => (item.groupId === group.id ? { ...item, groupId: remaining[0]!.id } : item)));
                }} />
              )}
            </Group>
          ))}
          {groups.length < MAX_GROUPS && (
            <AddButton testId={`group-add-${index}`} disabled={disabled} label={t.groupAdd} onClick={() => setGroups([...groups, { id: nextGroupId(groups), label: "" }])} />
          )}
          <Text size="sm" className="pp-editor-muted">{t.groupItemsHint}</Text>
          {items.map((item, ii) => (
            <Group key={ii} gap="xs">
              <TextInput size="md" className="pp-lesson-grow" data-testid={`group-item-${index}-${ii}`} value={item.text} disabled={disabled} maxLength={40}
                aria-label={t.groupItemLabel.replace("{n}", String(ii + 1))}
                onChange={(e) => {
                  const text = e.currentTarget.value;
                  onChange({ groupItems: items.map((it, i) => (i === ii ? { ...it, text } : it)) });
                }} />
              <NativeSelect size="md" className="pp-lesson-grow" data-testid={`group-item-group-${index}-${ii}`} value={item.groupId} disabled={disabled}
                aria-label={t.groupItemGroupLabel.replace("{n}", String(ii + 1))}
                data={groups.map((group, gi) => ({ value: group.id, label: group.label || t.groupLabelLabel.replace("{n}", String(gi + 1)) }))}
                onChange={(e) => {
                  const groupId = e.currentTarget.value;
                  onChange({ groupItems: items.map((it, i) => (i === ii ? { ...it, groupId } : it)) });
                }} />
              {items.length > MIN_GROUP_ITEMS && (
                <RemoveButton testId={`group-item-remove-${index}-${ii}`} disabled={disabled} onClick={() => onChange({ groupItems: items.filter((_, i) => i !== ii) })} />
              )}
            </Group>
          ))}
          {items.length < MAX_GROUP_ITEMS && groups.length > 0 && (
            <AddButton testId={`group-item-add-${index}`} disabled={disabled} label={t.groupItemAdd}
              onClick={() => onChange({ groupItems: [...items, { text: "", groupId: groups[0]!.id }] })} />
          )}
        </Stack>
      </fieldset>
    );
  }
  return null;
}
