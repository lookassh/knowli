"use client";

import { useState } from "react";
import { messages, type ChildDto } from "@learning/contracts";
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
            <button type="button" onClick={() => remove(child.id)}>
              {messages.children.remove}
            </button>
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
