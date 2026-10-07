"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  messages,
  type ChildDto,
  type DeckDto,
  type DraftDto,
  type VisualType,
} from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";

interface EditableItem {
  id: string | undefined;
  source: string;
  target: string;
  accepted: string;
  example: string;
  visualType: VisualType;
  locales: { source: string; target: string };
}

const VISUAL_TYPES: VisualType[] = ["image", "color", "number", "sequence", "none"];

/** DTO używa "approved", katalog komunikatów kluczem "ready". */
function mediaStateText(catalogue: Record<string, string>, state: string): string {
  return catalogue[state === "approved" ? "ready" : state] ?? "";
}

function toEditable(draft: DraftDto): { title: string; items: EditableItem[] } {
  return {
    title: draft.title,
    items: draft.items.map((item) => ({
      id: item.id,
      source: item.source,
      target: item.target,
      accepted: item.acceptedAnswers.join(", "),
      example: item.example ?? "",
      visualType: item.visualType,
      locales: item.locales,
    })),
  };
}

/**
 * Przegląd i edycja jednego zestawu: szkic z generacji, poprawki słów
 * i wariantów, podgląd audio/obrazów, świadome pominięcie obrazu, publikacja
 * i przypisania dzieci. Polling prowadzi dalej po odświeżeniu strony;
 * kosztowna regeneracja wymaga zawsze jawnego kliknięcia.
 */
export default function DeckEditor({
  deckId,
  childrenList,
  onBack,
}: {
  deckId: string;
  childrenList: ChildDto[];
  onBack: () => void;
}) {
  const [deck, setDeck] = useState<DeckDto | null>(null);
  const [form, setForm] = useState<{ title: string; items: EditableItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignDates, setAssignDates] = useState<Record<string, string>>({});
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      setDeck(await apiFetch<DeckDto>("GET", `/api/v1/parent/decks/${deckId}`));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  const draft = deck?.draft ?? null;
  const active = draft ?? deck?.published ?? null;
  const editable = draft !== null;

  const generating = deck?.generation?.state === "queued" || deck?.generation?.state === "running";
  const assetsPending = active?.assets.some((asset) => asset.state === "pending") ?? false;
  useEffect(() => {
    if (!generating && !assetsPending) {
      return;
    }
    const timer = setInterval(() => {
      void load();
    }, 1000);
    return () => clearInterval(timer);
  }, [generating, assetsPending, load]);

  // formularz podąża za szkicem, dopóki rodzic nie zaczął pisać
  useEffect(() => {
    if (!draft || dirty.current) {
      return;
    }
    setForm(toEditable(draft));
  }, [draft?.id, draft?.editNumber, draft]);

  const mutate = (field: "source" | "target" | "accepted" | "example" | "title", value: string, index?: number) => {
    dirty.current = true;
    setForm((current) => {
      if (!current) {
        return current;
      }
      if (field === "title") {
        return { ...current, title: value };
      }
      const items = current.items.map((item, position) =>
        position === index ? { ...item, [field]: value } : item,
      );
      return { ...current, items };
    });
  };

  const changeVisual = (index: number, visualType: VisualType) => {
    dirty.current = true;
    setForm((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, position) =>
              position === index ? { ...item, visualType } : item,
            ),
          }
        : current,
    );
  };

  const save = async () => {
    if (!draft || !form) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("PATCH", `/api/v1/parent/drafts/${draft.id}`, {
        title: form.title,
        items: form.items.map((item) => ({
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
        })),
        expectedEditNumber: draft.editNumber,
      });
      dirty.current = false;
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
      if ((cause as { code?: string }).code === "conflict") {
        dirty.current = false;
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!draft) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/drafts/${draft.id}/publish`, {
        expectedEditNumber: draft.editNumber,
      });
      dirty.current = false;
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/decks/${deckId}/archive`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!deck?.generation) {
      return;
    }
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/generation/${deck.generation.id}/retry`);
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const regenerate = async (itemRevisionId: string, role: "target_audio" | "illustration") => {
    if (!draft) {
      return;
    }
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/drafts/${draft.id}/assets/regenerate`, {
        itemRevisionId,
        role,
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const omitIllustration = async (itemRevisionId: string) => {
    if (!draft) {
      return;
    }
    setError(null);
    try {
      await apiFetch("POST", `/api/v1/parent/drafts/${draft.id}/assets/omit`, { itemRevisionId });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const playAsset = (assetId: string) => {
    const audio = new Audio(`/api/v1/media/${assetId}`);
    void audio.play().catch(() => undefined);
  };

  const assign = async (childId: string) => {
    setError(null);
    try {
      await apiFetch("PUT", `/api/v1/parent/assignments/${childId}/${deckId}`, {
        testDate: assignDates[childId] || null,
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const assetOf = (revisionId: string, role: string) =>
    active?.assets.find((asset) => asset.itemRevisionId === revisionId && asset.role === role) ?? null;

  return (
    <section>
      <div className="row space">
        <button type="button" data-testid="editor-back" onClick={onBack}>
          {messages.decks.back}
        </button>
        <h2>{deck?.title ?? ""}</h2>
        {deck?.state === "published" && (
          <span className="badge ok" data-testid="publish-status">
            {messages.decks.published}
          </span>
        )}
      </div>

      {generating && (
        <p className="info" data-testid="generation-banner">
          {messages.decks.generating}
        </p>
      )}
      {deck?.generation?.state === "failed" && (
        <p className="error" data-testid="generation-failed">
          {messages.decks.generationFailed}{" "}
          <button type="button" onClick={retry}>
            {messages.decks.retryGeneration}
          </button>
        </p>
      )}
      {error && (
        <p className="error" data-testid="api-error" role="alert">
          {error}
        </p>
      )}

      {form?.items.map((item, index) => {
        const revisionId = active?.items[index]?.revisionId ?? "";
        const targetAudio = assetOf(revisionId, "target_audio");
        const exampleAudio = assetOf(revisionId, "example_audio");
        const illustration = assetOf(revisionId, "illustration");
        return (
          <article className="card" key={revisionId || index} data-testid={`item-card-${index}`}>
            <div className="grid-2">
              <label>
                {messages.decks.sourceLabel}
                <input
                  data-testid={`item-source-${index}`}
                  value={item.source}
                  disabled={!editable}
                  onChange={(event) => mutate("source", event.target.value, index)}
                />
              </label>
              <label>
                {messages.decks.targetLabel}
                <input
                  data-testid={`item-target-${index}`}
                  value={item.target}
                  disabled={!editable}
                  onChange={(event) => mutate("target", event.target.value, index)}
                />
              </label>
            </div>
            <label>
              {messages.decks.acceptedLabel}
              <input
                data-testid={`item-accepted-${index}`}
                value={item.accepted}
                disabled={!editable}
                onChange={(event) => mutate("accepted", event.target.value, index)}
              />
            </label>
            <label>
              {messages.decks.exampleLabel}
              <input
                data-testid={`item-example-${index}`}
                value={item.example}
                disabled={!editable}
                onChange={(event) => mutate("example", event.target.value, index)}
              />
            </label>
            <label>
              {messages.decks.visualLabel}
              <select
                data-testid={`item-visual-${index}`}
                value={item.visualType}
                disabled={!editable}
                onChange={(event) => changeVisual(index, event.target.value as VisualType)}
              >
                {VISUAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {messages.decks.visualTypes[type]}
                  </option>
                ))}
              </select>
            </label>

            {targetAudio && (
              <div className="row">
                <span data-testid={`item-audio-state-${index}`}>
                  {mediaStateText(messages.decks.audioState, targetAudio.state)}
                </span>
                <button
                  type="button"
                  data-testid={`item-play-${index}`}
                  disabled={!(targetAudio.state === "approved" && targetAudio.assetId)}
                  onClick={() => targetAudio.assetId && playAsset(targetAudio.assetId)}
                >
                  {messages.decks.listen}
                </button>
                {editable && (
                  <button
                    type="button"
                    data-testid={`item-regen-audio-${index}`}
                    onClick={() => regenerate(revisionId, "target_audio")}
                  >
                    {messages.decks.regenerateAudio}
                  </button>
                )}
              </div>
            )}
            {exampleAudio && (
              <div className="row">
                <span data-testid={`item-example-audio-state-${index}`}>
                  {mediaStateText(messages.decks.audioState, exampleAudio.state)}
                </span>
                <button
                  type="button"
                  data-testid={`item-play-example-${index}`}
                  disabled={!(exampleAudio.state === "approved" && exampleAudio.assetId)}
                  onClick={() => exampleAudio.assetId && playAsset(exampleAudio.assetId)}
                >
                  {messages.decks.listen}
                </button>
              </div>
            )}
            {illustration && (
              <div>
                {illustration.state === "approved" && illustration.assetId && (
                  <img
                    className="illustration"
                    data-testid={`item-image-${index}`}
                    src={`/api/v1/media/${illustration.assetId}`}
                    alt={item.target}
                  />
                )}
                <div className="row">
                  <span data-testid={`item-image-state-${index}`}>
                    {mediaStateText(messages.decks.imageState, illustration.state)}
                  </span>
                  {editable && illustration.state !== "omitted" && (
                    <button
                      type="button"
                      data-testid={`item-omit-image-${index}`}
                      onClick={() => omitIllustration(revisionId)}
                    >
                      {messages.decks.omitImage}
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      data-testid={`item-regen-image-${index}`}
                      onClick={() => regenerate(revisionId, "illustration")}
                    >
                      {messages.decks.regenerateImage}
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}

      {editable && (
        <div className="row">
          <button type="button" data-testid="save-items" onClick={save} disabled={busy}>
            {messages.decks.save}
          </button>
          <button type="button" data-testid="publish-deck" onClick={publish} disabled={busy}>
            {messages.decks.publish}
          </button>
          <button type="button" data-testid="archive-deck" onClick={archive} disabled={busy}>
            {messages.decks.archive}
          </button>
        </div>
      )}

      {deck?.state === "published" && (
        <section className="card">
          <h3>{messages.decks.assignTitle}</h3>
          {childrenList.map((child, index) => (
            <div className="row space" key={child.id} data-testid={`assign-row-${index}`}>
              <span>{child.displayName}</span>
              <input
                type="date"
                data-testid={`assign-date-${index}`}
                aria-label={`${messages.decks.assignDate} ${child.displayName}`}
                value={assignDates[child.id] ?? ""}
                onChange={(event) =>
                  setAssignDates((current) => ({ ...current, [child.id]: event.target.value }))
                }
              />
              <button type="button" data-testid={`assign-submit-${index}`} onClick={() => assign(child.id)}>
                {messages.decks.assign}
              </button>
            </div>
          ))}
          <ul className="plain">
            {deck.assignments.map((assignment, index) => (
              <li key={assignment.childId} data-testid={`assignment-row-${index}`}>
                {assignment.displayName} — {assignment.testDate ?? messages.decks.noDate}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
