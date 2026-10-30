"use client";

import { Button, Group, NativeSelect, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LessonVoiceToneSchema, messages, type LessonPromptAudioDto, type LessonVoiceTone } from "@learning/contracts";
import { ORPCError } from "@orpc/client";
import { ApiCallError, errorMessage } from "../api";
import { ParentIcon } from "../ParentIcon";
import { orpc } from "../query-client";

const TONE_LABELS: Record<LessonVoiceTone, string> = {
  cheerful: messages.lessons.voiceToneCheerful,
  curious: messages.lessons.voiceToneCurious,
  gentle: messages.lessons.voiceToneGentle,
  mysterious: messages.lessons.voiceToneMysterious,
};

const TONE_OPTIONS = [
  { value: "", label: messages.lessons.voiceToneDefault },
  ...LessonVoiceToneSchema.options.map((tone) => ({ value: tone, label: TONE_LABELS[tone] })),
];

/**
 * „Ton lektora” ćwiczenia albo karty. „Domyślny” (wartość pusta) usuwa pole
 * z patcha. Wspólny dla karty ćwiczenia i karty zagadnienia.
 */
export function VoiceToneSelect({ value, disabled, testId, hint = messages.lessons.voiceToneHint, onChange }: {
  value: LessonVoiceTone | undefined;
  disabled: boolean;
  testId: string;
  /** Podpowiedź pod polem: pytanie (domyślnie) albo karta. */
  hint?: string;
  onChange: (tone: LessonVoiceTone | undefined) => void;
}) {
  return (
    <NativeSelect size="md" label={messages.lessons.voiceToneLabel} description={hint}
      data-testid={testId} value={value ?? ""} disabled={disabled} data={TONE_OPTIONS}
      onChange={(e) => {
        const parsed = LessonVoiceToneSchema.safeParse(e.currentTarget.value);
        onChange(parsed.success ? parsed.data : undefined);
      }} />
  );
}

/**
 * „Nagraj ponownie” odrzucone konfliktem: od ostatniego zapisu szkicu zmieniła
 * się konfiguracja TTS (`tts_config_changed`) — to jedyny konflikt tej operacji.
 */
export function isTtsConfigChangedError(error: unknown): boolean {
  return (error instanceof ORPCError && error.code === "conflict")
    || (error instanceof ApiCallError && error.code === "conflict");
}

/** Nagranie, którego dotyczą przyciski: pytanie ćwiczenia albo karta zagadnienia. */
export type PromptAudioTarget =
  | { kind: "prompt"; itemRevisionId: string }
  | { kind: "card"; objectiveId: string; cardIndex: number };

/**
 * Odsłuch i „Nagraj ponownie” nagrania pytania lub karty (spec tonu TTS §4.5).
 * `ready` → „Posłuchaj” + „Nagraj ponownie”; `failed` → komunikat + „Nagraj
 * ponownie”; `pending` → „Nagrywanie…”. Nowe nagranie tylko w szkicu i bez
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
      {audio.state === "ready" && audio.assetId && (
        <Button size="md" variant="light" leftSection={<ParentIcon name="volume" />} data-testid={`${testId}-listen`}
          onClick={() => onPlay(audio.assetId!)}>
          {messages.lessons.promptAudioListen}
        </Button>
      )}
      {canRegenerate && audio.state !== "pending" && (
        <Button size="md" variant="subtle" leftSection={<ParentIcon name="refresh" />} data-testid={`${testId}-regenerate`}
          disabled={locked || mutation.isPending} loading={mutation.isPending} onClick={regenerate}>
          {messages.lessons.promptAudioRegenerate}
        </Button>
      )}
      {mutation.isError && (
        <Text size="sm" c="red" role="alert" data-testid={`${testId}-error`}>
          {isTtsConfigChangedError(mutation.error) ? messages.lessons.promptAudioConfigChanged : errorMessage(mutation.error)}
        </Text>
      )}
    </Group>
  );
}
