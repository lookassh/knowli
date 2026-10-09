"use client";

import { useCallback, useEffect, useState } from "react";
import { messages, type ChildDto, type PronunciationSettingsDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";

const AVATARS: Array<{ key: string; emoji: string }> = [
  { key: "fox", emoji: "🦊" },
  { key: "cat", emoji: "🐱" },
  { key: "owl", emoji: "🦉" },
  { key: "panda", emoji: "🐼" },
];

function avatarEmoji(key: string): string {
  return AVATARS.find((avatar) => avatar.key === key)?.emoji ?? "🙂";
}

function PronunciationSettings({ childId }: { childId: string }) {
  const [settings, setSettings] = useState<PronunciationSettingsDto | null>(null);
  const [good, setGood] = useState("");
  const [almost, setAlmost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await apiFetch<PronunciationSettingsDto>("GET", `/api/v1/parent/children/${childId}/pronunciation`);
    setSettings(data);
    if (data.thresholds) {
      setGood(String(data.thresholds.correctMinScore));
      setAlmost(String(data.thresholds.partialMinScore));
    }
  }, [childId]);

  useEffect(() => {
    load().catch((cause) => setError(errorMessage(cause)));
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("PUT", `/api/v1/parent/children/${childId}/pronunciation`, {
        correctMinScore: Number(good),
        partialMinScore: Number(almost),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="hint">…</p>;
  return (
    <section className="card" data-testid="child-pronunciation-settings">
      <h3>{messages.children.pronunciationTitle}</h3>
      {!settings.pronunciationAvailable || !settings.thresholds ? (
        <p>{messages.children.pronunciationUnavailable}</p>
      ) : (
        <>
          <label>
            {messages.children.pronunciationThresholdGood}
            <input
              data-testid="child-threshold-good"
              type="number"
              min={0}
              max={100}
              value={good}
              onChange={(event) => setGood(event.target.value)}
            />
          </label>
          <label>
            {messages.children.pronunciationThresholdAlmost}
            <input
              data-testid="child-threshold-almost"
              type="number"
              min={0}
              max={100}
              value={almost}
              onChange={(event) => setAlmost(event.target.value)}
            />
          </label>
          <button type="button" data-testid="child-settings-save" onClick={save} disabled={busy}>
            {messages.children.pronunciationSave}
          </button>
          <h4>{messages.children.pronunciationAttemptsTitle}</h4>
          <ul className="plain" data-testid="child-attempts">
            {settings.attempts.length === 0 && <li>{messages.children.pronunciationEmpty}</li>}
            {settings.attempts.map((attempt, index) => (
              <li data-testid="child-attempt-row" key={`${attempt.attemptedAt}-${index}`}>
                {attempt.word} — {Math.round(attempt.score)} ({
                  attempt.band === "correct"
                    ? messages.children.pronunciationBandCorrect
                    : attempt.band === "partial"
                      ? messages.children.pronunciationBandPartial
                      : messages.children.pronunciationBandBelow
                }) · {attempt.attemptedAt}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

/** Profile dzieci: dodawanie i usuwanie; usunięcie zabiera historię dziecka. */
export default function ChildEditor({
  childrenList,
  onChanged,
}: {
  childrenList: ChildDto[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]!.key);
  const [birthYear, setBirthYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSettings, setOpenSettings] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("POST", "/api/v1/parent/children", {
        displayName: name,
        avatarKey: avatar,
        ...(birthYear ? { birthYear: Number(birthYear) } : {}),
      });
      setName("");
      setBirthYear("");
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (childId: string) => {
    if (!window.confirm(messages.children.removeConfirm)) {
      return;
    }
    setError(null);
    try {
      await apiFetch("DELETE", `/api/v1/parent/children/${childId}`);
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <section>
      <h2>{messages.children.title}</h2>
      {childrenList.length === 0 && <p>{messages.children.empty}</p>}
      <ul className="plain">
        {childrenList.map((child, index) => (
          <li className="card row space" key={child.id} data-testid={`child-row-${index}`}>
            <span>
              {avatarEmoji(child.avatarKey)} {child.displayName}
              {child.birthYear ? ` (${child.birthYear})` : ""}
            </span>
            <div className="row">
              <button
                type="button"
                data-testid={`child-settings-${index}`}
                aria-expanded={openSettings === child.id}
                onClick={() => setOpenSettings(openSettings === child.id ? null : child.id)}
              >
                {messages.children.pronunciationTitle}
              </button>
              <button type="button" onClick={() => remove(child.id)}>
                {messages.children.remove}
              </button>
            </div>
            {openSettings === child.id && <PronunciationSettings childId={child.id} />}
          </li>
        ))}
      </ul>
      <section className="card">
        <label>
          {messages.children.displayName}
          <input data-testid="child-name" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {messages.children.avatar}
          <select data-testid="child-avatar" value={avatar} onChange={(event) => setAvatar(event.target.value)}>
            {AVATARS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.emoji}
              </option>
            ))}
          </select>
        </label>
        <label>
          {messages.children.birthYear}
          <input
            data-testid="child-year"
            type="number"
            min={1900}
            max={2200}
            value={birthYear}
            onChange={(event) => setBirthYear(event.target.value)}
          />
        </label>
        <button type="button" data-testid="child-add" onClick={add} disabled={busy || name.length === 0}>
          {messages.children.add}
        </button>
        {error && (
          <p className="error" data-testid="api-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </section>
  );
}
