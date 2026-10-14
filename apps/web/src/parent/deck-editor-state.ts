import type { DraftDto, DraftPatch, VisualType, VocabularyFormat } from "@learning/contracts";

export interface EditableDeckItem {
  clientKey: string;
  id?: string;
  source: string;
  target: string;
  accepted: string;
  example: string;
  visualType: VisualType;
  locales: { source: string; target: string };
  visualData?: Record<string, unknown>;
}

export interface EditableDeckForm {
  title: string;
  vocabularyFormat: VocabularyFormat;
  items: EditableDeckItem[];
}

export interface EditorSnapshot {
  draftId: string;
  editNumber: number;
  form: EditableDeckForm;
}

export interface EditorFormComparison {
  title: { local: string; remote: string };
  rows: { key: string; local: EditableDeckItem | null; remote: EditableDeckItem | null }[];
}

export function createEditorSnapshot(
  draft: DraftDto,
  newKey: () => string,
): EditorSnapshot {
  return {
    draftId: draft.id,
    editNumber: draft.editNumber,
    form: {
      title: draft.title,
      vocabularyFormat: draft.vocabularyFormat,
      items: draft.items.map((item) => ({
        clientKey: item.id || `local:${newKey()}`,
        id: item.id,
        source: item.source,
        target: item.target,
        accepted: item.acceptedAnswers.join(", "),
        example: item.example ?? "",
        visualType: item.visualType,
        locales: item.locales,
        ...(item.visualData ? { visualData: item.visualData } : {}),
      })),
    },
  };
}

export function createNewEditableItem(
  locales: EditableDeckItem["locales"],
  newKey: () => string,
): EditableDeckItem {
  return {
    clientKey: `local:${newKey()}`,
    source: "",
    target: "",
    accepted: "",
    example: "",
    visualType: "image",
    locales,
  };
}

export function toDraftPatch(snapshot: EditorSnapshot): DraftPatch {
  return {
    title: snapshot.form.title.trim(),
    ...(snapshot.form.items.length > 0
      ? {
          items: snapshot.form.items.map((item) => ({
            ...(item.id ? { id: item.id } : {}),
            source: item.source,
            target: item.target,
            acceptedAnswers: item.accepted
              .split(",")
              .map((variant) => variant.trim())
              .filter((variant) => variant.length > 0),
            locales: item.locales,
            ...(item.example ? { example: item.example } : {}),
            visualType: item.visualType,
            ...(item.visualData ? { visualData: item.visualData } : {}),
          })),
        }
      : {}),
    expectedEditNumber: snapshot.editNumber,
  };
}

export function sameEditableItem(left: EditableDeckItem, right: EditableDeckItem): boolean {
  return left.id === right.id
    && left.source === right.source
    && left.target === right.target
    && left.accepted === right.accepted
    && left.example === right.example
    && left.visualType === right.visualType
    && left.locales.source === right.locales.source
    && left.locales.target === right.locales.target
    && JSON.stringify(left.visualData) === JSON.stringify(right.visualData);
}

export function compareEditorForms(
  local: EditableDeckForm,
  remote: EditableDeckForm,
): EditorFormComparison {
  const remoteByKey = new Map(remote.items.map((item) => [item.clientKey, item]));
  const localKeys = new Set(local.items.map((item) => item.clientKey));
  const rows: EditorFormComparison["rows"] = local.items.map((item) => ({
    key: item.clientKey,
    local: item,
    remote: remoteByKey.get(item.clientKey) ?? null,
  }));
  for (const item of remote.items) {
    if (!localKeys.has(item.clientKey)) {
      rows.push({ key: item.clientKey, local: null, remote: item });
    }
  }
  return { title: { local: local.title, remote: remote.title }, rows };
}
