"use client";

import { useEffect } from "react";
import { Alert, Button, Group, Loader, NumberInput, Stack, Text, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { messages, type PronunciationSettingsDto } from "@learning/contracts";
import { callParent, errorMessage, parentClient } from "./api";
import { orpc } from "./query-client";
import { validateThresholds, type ThresholdValues } from "./children-forms";
import type { EditorLeaveState } from "./useParentLeaveGuard";

function bandLabel(band: PronunciationSettingsDto["attempts"][number]["band"]): string {
  if (band === "correct") return messages.children.pronunciationBandCorrect;
  if (band === "partial") return messages.children.pronunciationBandPartial;
  return messages.children.pronunciationBandBelow;
}

/**
 * Progi oceny wymowy dziecka i ostatnie próby (lista kalibracyjna).
 * Niezapisane progi i trwający zapis zgłasza `onStateChange` (leave guard).
 */
export default function PronunciationSettings({
  childId,
  onStateChange,
}: {
  childId: string;
  onStateChange: (state: EditorLeaveState | null) => void;
}) {
  const queryClient = useQueryClient();
  const queryOptions = orpc.children.getPronunciation.queryOptions({ input: { childId } });
  // dane z pamięci podręcznej mogą być starsze (zapis przerwany zamknięciem,
  // zmiana w innej przeglądarce) — formularz czeka na odczyt po otwarciu
  const settings = useQuery({ ...queryOptions, refetchOnMount: "always" });
  const ready = settings.isFetchedAfterMount;
  const form = useForm<ThresholdValues>({
    initialValues: { good: "", almost: "" },
    validate: validateThresholds,
  });
  const save = useMutation({
    mutationFn: (values: { correctMinScore: number; partialMinScore: number }) =>
      callParent(() => parentClient.children.putPronunciation({ childId, ...values })),
    // w opcjach hooka: odświeżenie odczytu następuje także, gdy panel zamknięto w trakcie zapisu
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey }),
  });

  const thresholds = ready ? settings.data?.thresholds : undefined;
  useEffect(() => {
    // dane serwera zasilają formularz raz; późniejsze odświeżenia (po zapisie)
    // nie nadpisują tego, co rodzic właśnie wpisuje
    if (thresholds) form.initialize({ good: thresholds.correctMinScore, almost: thresholds.partialMinScore });
  }, [thresholds]);

  const dirty = form.isDirty();
  useEffect(() => {
    onStateChange({ dirty, busy: save.isPending });
  }, [onStateChange, dirty, save.isPending]);
  useEffect(() => () => onStateChange(null), [onStateChange]);

  const submit = form.onSubmit((values) => {
    save.reset();
    save.mutate(
      { correctMinScore: Number(values.good), partialMinScore: Number(values.almost) },
      {
        onSuccess: () => {
          form.setInitialValues(values);
          form.resetDirty(values);
        },
      },
    );
  });

  return (
    <Stack gap="sm" mt="md" className="pp-children-settings" data-testid="child-pronunciation-settings">
      <Title order={3} fz="md">{messages.children.pronunciationTitle}</Title>
      {!ready ? (
        <Group gap="xs" role="status">
          <Loader size="xs" />
          <Text size="sm">{messages.children.pronunciationLoading}</Text>
        </Group>
      ) : settings.data === undefined ? (
        <Alert color="red" variant="light" role="alert">{errorMessage(settings.error)}</Alert>
      ) : !settings.data.pronunciationAvailable || !settings.data.thresholds ? (
        <Text size="sm">{messages.children.pronunciationUnavailable}</Text>
      ) : (
        <>
          {/* nieudane odświeżenie przy istniejących danych nie chowa formularza */}
          {settings.isError && <Alert color="red" variant="light" role="alert">{errorMessage(settings.error)}</Alert>}
          <form onSubmit={submit} noValidate>
            <Stack gap="sm">
              <NumberInput
                size="md"
                label={messages.children.pronunciationThresholdGood}
                data-testid="child-threshold-good"
                min={0}
                max={100}
                allowDecimal={false}
                allowNegative={false}
                clampBehavior="none"
                hideControls
                disabled={save.isPending}
                {...form.getInputProps("good")}
              />
              <NumberInput
                size="md"
                label={messages.children.pronunciationThresholdAlmost}
                data-testid="child-threshold-almost"
                min={0}
                max={100}
                allowDecimal={false}
                allowNegative={false}
                clampBehavior="none"
                hideControls
                disabled={save.isPending}
                {...form.getInputProps("almost")}
              />
              {save.isError && <Alert color="red" variant="light" role="alert">{errorMessage(save.error)}</Alert>}
              {save.isSuccess && !dirty && <Text size="sm" role="status">{messages.children.pronunciationSaved}</Text>}
              <Button type="submit" size="md" variant="light" data-testid="child-settings-save" disabled={save.isPending}>
                {messages.children.pronunciationSave}
              </Button>
            </Stack>
          </form>
          <Title order={4} fz="sm" mt="xs">{messages.children.pronunciationAttemptsTitle}</Title>
          <ul className="pp-children-attempts" data-testid="child-attempts">
            {settings.data.attempts.length === 0 && <li className="pp-children-muted">{messages.children.pronunciationEmpty}</li>}
            {settings.data.attempts.map((attempt, index) => (
              <li data-testid="child-attempt-row" key={`${attempt.attemptedAt}-${index}`}>
                <Text span fw={600}>{attempt.word}</Text> — {Math.round(attempt.score)} ({bandLabel(attempt.band)})
                <Text span size="xs" className="pp-children-muted"> · {attempt.attemptedAt}</Text>
              </li>
            ))}
          </ul>
        </>
      )}
    </Stack>
  );
}
