"use client";

import { useState } from "react";
import { Alert, Button, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { messages } from "@learning/contracts";
import { ApiCallError, callParent, errorMessage, parentClient } from "./api";

/**
 * Zmiana PIN-u rodzica (#400). Wywołanie przez `callParent`, nie `useMutation`:
 * zły obecny PIN to 401 `invalid_credentials`, a globalny handler 401 zapytań
 * wylogowałby rodzica. Po sukcesie serwer usuwa wszystkie sesje — `onSignedOut`;
 * tak samo przy `unauthorized`/`conflict` (sesja wygasła albo PIN zmieniono gdzie indziej).
 */
export function ChangeSecretDialog({
  opened,
  onClose,
  onSignedOut,
}: {
  opened: boolean;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [currentSecret, setCurrentSecret] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [repeatSecret, setRepeatSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrentSecret("");
    setNewSecret("");
    setRepeatSecret("");
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const signOut = () => {
    reset();
    onSignedOut();
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      centered
      radius="lg"
      title={messages.auth.changeSecretTitle}
      attributes={{ content: { "data-testid": "change-secret-dialog" } }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          // te same granice co assertSecretShape na serwerze
          if (newSecret.length < 4 || newSecret.length > 200) {
            setError(messages.auth.newSecretDescription);
            return;
          }
          if (newSecret !== repeatSecret) {
            setError(messages.auth.secretMismatch);
            return;
          }
          setBusy(true);
          setError(null);
          callParent(() => parentClient.auth.changeSecret({ currentSecret, newSecret }))
            .then(signOut)
            .catch((cause: unknown) => {
              if (cause instanceof ApiCallError && (cause.code === "unauthorized" || cause.code === "conflict")) {
                signOut();
                return;
              }
              setError(errorMessage(cause));
            })
            .finally(() => setBusy(false));
        }}
      >
        <Stack gap="md">
          <Text size="sm">{messages.auth.changeSecretHint}</Text>
          <PasswordInput
            label={messages.auth.currentSecretLabel}
            size="md"
            autoComplete="current-password"
            required
            value={currentSecret}
            onChange={(event) => setCurrentSecret(event.currentTarget.value)}
            data-testid="change-secret-current"
            data-autofocus
          />
          <PasswordInput
            label={messages.auth.newSecretLabel}
            description={messages.auth.newSecretDescription}
            size="md"
            autoComplete="new-password"
            required
            value={newSecret}
            onChange={(event) => setNewSecret(event.currentTarget.value)}
            data-testid="change-secret-new"
          />
          <PasswordInput
            label={messages.auth.repeatSecretLabel}
            size="md"
            autoComplete="new-password"
            required
            value={repeatSecret}
            onChange={(event) => setRepeatSecret(event.currentTarget.value)}
            data-testid="change-secret-repeat"
          />
          {error && (
            <Alert color="red" variant="light" role="alert" data-testid="change-secret-error">
              {error}
            </Alert>
          )}
          <Button type="submit" size="md" loading={busy} data-testid="change-secret-submit">
            {messages.auth.changeSecretButton}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
