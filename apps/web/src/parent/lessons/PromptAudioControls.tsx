"use client";

import { Button, Group, NativeSelect, Text } from "@mantine/core";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LessonVoiceToneSchema, messages, type LessonPromptAudioDto, type LessonVoiceTone } from "@learning/contracts";
import { errorMessage } from "../api";
import { ParentIcon } from "../ParentIcon";
import { orpc } from "../query-client";

const TONE_LABELS: Record<LessonVoiceTone, string> = {
  cheerful: messages.lessons.voiceToneCheerful,
  curious: messages.lessons.voiceToneCurious,
  gentle: messages.lessons.voiceToneGentle,
  mysterious: messages.lessons.voiceToneMysterious,
};

/**
 * „Ton lektora” ćwiczenia albo karty. „Domyślny” (wartość pusta) usuwa pole
 * z patcha. Wspólny dla karty ćwiczenia i karty zagadnienia. Pytanie nigdy nie
 * jest szeptane (spec tonu TTS §4.3), więc bez `whisper` nie ma „Tajemniczo” —
 * chyba że ten ton jest już zapisany, żeby pole pokazywało stan.
 */
export function VoiceToneSelect({ value, disabled, testId, hint = messages.lessons.voiceToneHint, whisper = false, onChange }: {
  value: LessonVoiceTone | undefined;
  disabled: boolean;
  testId: string;
  /** Podpowiedź pod polem: pytanie (domyślnie) albo karta. */
  hint?: string;
  /** Ton „Tajemniczo” (szept) ma skutek: karta tak, pytanie nie. */
  whisper?: boolean;
  onChange: (tone: LessonVoiceTone | undefined) => void;
}) {
  const options = [
    { value: "", label: messages.lessons.voiceToneDefault },
    ...LessonVoiceToneSchema.options
      .filter((tone) => tone !== "mysterious" || whisper || value === "mysterious")
      .map((tone) => ({ value: tone, label: TONE_LABELS[tone] })),
  ];
  return (
    <NativeSelect size="md" label={messages.lessons.voiceToneLabel} description={hint}
      data-testid={testId} value={value ?? ""} disabled={disabled} data={options}
      onChange={(e) => {
        const parsed = LessonVoiceToneSchema.safeParse(e.currentTarget.value);
        onChange(parsed.success ? parsed.data : undefined);
      }} />
  );
}

/** Nagranie, którego dotyczą przyciski: pytanie ćwiczenia albo karta zagadnienia. */
export type PromptAudioTarget =
  | { kind: "prompt"; itemRevisionId: string }
  | { kind: "card"; objectiveId: string; cardIndex: number };

/**
 * Odsłuch i „Nagraj ponownie” nagrania pytania lub karty (spec tonu TTS §4.5).
 * `ready` → „Posłuchaj”; `pending` → „Nagrywanie…”; `failed` → komunikat.
 * Przy `pending` i `failed` „Posłuchaj poprzedniego” odtwarza ujęcie, które
 * słyszy dziecko, gdy takie jest. „Nagraj ponownie” jest w każdym stanie: przy
 * `pending` serwer zwraca trwające nagranie, chyba że zmieniła się konfiguracja
 * lektora — wtedy przenosi je do bieżącej (zlecenie starej konfiguracji worker
 * pomija, więc bez tego „Nagrywanie…” trwałoby bez końca). Nowe nagranie tylko w szkicu i bez
 * niezapisanych zmian (`locked`) — serwer generuje je z zapisanego tekstu
 * i tonu. Po sukcesie odświeżamy odczyt lekcji; dopóki nagranie jest
 * `pending`, edytor odpytuje lekcję (`lessonPollInterval`), więc „Nagrywanie…”
 * znika samo, gdy nagranie będzie gotowe albo nieudane.
 */
export default function PromptAudioControls({ audio, target, lessonDraftId, deckId, canRegenerate, locked, testId, onPlay }: {
  audio: LessonPromptAudioDto;
  target: PromptAudioTarget;
  lessonDraftId: string;
  deckId: string;
  canRegenerate: boolean;
  /** Edytor jest zajęty albo ma niezapisane zmiany. */
  locked: boolean;
  testId: string;
  onPlay: (assetId: string) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: orpc.lessons.get.queryKey({ input: { deckId } }) }); };
  const promptMutation = useMutation(orpc.lessonDrafts.regeneratePromptAudio.mutationOptions({ onSuccess: refresh }));
  const cardMutation = useMutation(orpc.lessonDrafts.regenerateCardAudio.mutationOptions({ onSuccess: refresh }));
  const mutation = target.kind === "prompt" ? promptMutation : cardMutation;
  // Błąd dotyczy nagrania sprzed zmiany: gdy stan nagrania się zmieni (zapis szkicu,
  // odpytywanie), komunikat znika zamiast wisieć obok nowego stanu.
  const { reset: resetPrompt } = promptMutation;
  const { reset: resetCard } = cardMutation;
  useEffect(() => {
    resetPrompt();
    resetCard();
  }, [audio.state, audio.assetId, resetPrompt, resetCard]);

  const regenerate = () => {
    if (target.kind === "prompt") promptMutation.mutate({ lessonDraftId, itemRevisionId: target.itemRevisionId });
    else cardMutation.mutate({ lessonDraftId, objectiveId: target.objectiveId, cardIndex: target.cardIndex });
  };

  return (
    <Group gap="xs" align="center" data-testid={testId} data-audio-state={audio.state}>
      {audio.state === "pending" && (
        <Text size="sm" className="pp-editor-muted" role="status" data-testid={`${testId}-pending`}>{messages.lessons.promptAudioPending}</Text>
      )}
      {audio.state === "failed" && (
        <Text size="sm" c="red" role="status" data-testid={`${testId}-failed`}>{messages.lessons.promptAudioFailed}</Text>
      )}
      {audio.state !== "ready" && audio.previousAssetId && (
        <Button size="md" variant="light" leftSection={<ParentIcon name="volume" />} data-testid={`${testId}-listen-previous`}
          onClick={() => onPlay(audio.previousAssetId!)}>
          {messages.lessons.promptAudioListenPrevious}
        </Button>
      )}
      {audio.state === "ready" && audio.assetId && (
        <Button size="md" variant="light" leftSection={<ParentIcon name="volume" />} data-testid={`${testId}-listen`}
          onClick={() => onPlay(audio.assetId!)}>
          {messages.lessons.promptAudioListen}
        </Button>
      )}
      {canRegenerate && (
        <Button size="md" variant="subtle" leftSection={<ParentIcon name="refresh" />} data-testid={`${testId}-regenerate`}
          disabled={locked || mutation.isPending} loading={mutation.isPending} onClick={regenerate}>
          {messages.lessons.promptAudioRegenerate}
        </Button>
      )}
      {mutation.isError && (
        <Text size="sm" c="red" role="alert" data-testid={`${testId}-error`}>
          {errorMessage(mutation.error)}
        </Text>
      )}
    </Group>
  );
}
