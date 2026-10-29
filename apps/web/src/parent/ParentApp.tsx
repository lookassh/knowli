"use client";

import { useCallback, useState } from "react";
import { Alert, Button, Center, Group, Loader, Modal, Paper, Stack, Text, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { messages } from "@learning/contracts";
import { callParent, errorMessage, parentClient } from "./api";
import ChildEditor from "./ChildEditor";
import DecksPanel from "./DecksPanel";
import LeaveEditorDialog from "./LeaveEditorDialog";
import ProgressPanel from "./ProgressPanel";
import WorkCardPanel from "./WorkCardPanel";
import { useParentLeaveGuard } from "./useParentLeaveGuard";
import { useParentNavigation } from "./useParentNavigation";
import { ParentAuthForm } from "./ParentAuthForm";
import { ParentShell } from "./ParentShell";
import { useAuthExpiredHandler } from "./ParentProviders";
import { orpc } from "./query-client";
import "./parent.css";

const SIGNED_OUT = { authenticated: false, setupRequired: false };
const AUTH_KEY = orpc.auth.state.queryOptions().queryKey;
const CHILDREN_KEY = orpc.children.list.queryOptions().queryKey;
const DECKS_KEY = orpc.decks.list.queryOptions().queryKey;

function Brand() {
  return (
    <Group gap="sm" wrap="nowrap">
      <span className="pp-shell-logo" aria-hidden="true">U!</span>
      <div>
        <Text fw={700} lh={1.2}>{messages.app.name}</Text>
        <Text fz="xs" className="pp-shell-subtle">{messages.app.parentPanel}</Text>
      </div>
    </Group>
  );
}

/**
 * Panel rodzica Umiem!: pierwsze uruchomienie (PIN), logowanie, rama z sekcjami
 * w adresie (/parent/decks, /parent/children, …). Stan sesji pochodzi z API —
 * przyciski nie są "zabezpieczeniem".
 */
export default function ParentApp() {
  const queryClient = useQueryClient();
  const leaveGuard = useParentLeaveGuard();
  const { section, navigate } = useParentNavigation(leaveGuard);
  const [reauthOpen, setReauthOpen] = useState(false);

  // Stan sesji czytamy raz przy starcie panelu. Później o wygaśnięciu mówią
  // wyłącznie odpowiedzi 401 (toLogin) — samoczynne odświeżenie auth.state
  // (np. po powrocie sieci) odmontowałoby edytor z niezapisanymi zmianami.
  const auth = useQuery({
    ...orpc.auth.state.queryOptions(),
    retry: false,
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const authenticated = auth.data?.authenticated === true;
  const childrenQuery = useQuery({ ...orpc.children.list.queryOptions(), enabled: authenticated });
  const decksQuery = useQuery({ ...orpc.decks.list.queryOptions(), enabled: authenticated });

  // odświeżenie po zmianie: odrzucona obietnica pozwala ekranom zgłosić nieudane odświeżenie
  const refreshChildren = useCallback(
    () => queryClient.refetchQueries({ queryKey: CHILDREN_KEY, exact: true }, { throwOnError: true }),
    [queryClient],
  );
  const refreshDecks = useCallback(
    () => queryClient.refetchQueries({ queryKey: DECKS_KEY, exact: true }, { throwOnError: true }),
    [queryClient],
  );

  const signOutLocally = useCallback(() => {
    queryClient.setQueryData(AUTH_KEY, SIGNED_OUT);
    queryClient.removeQueries({ queryKey: CHILDREN_KEY, exact: true });
    queryClient.removeQueries({ queryKey: DECKS_KEY, exact: true });
  }, [queryClient]);

  /**
   * Wygasła sesja (401). Z niezapisanymi zmianami w edytorze logowanie otwiera
   * się w oknie nad bieżącym widokiem — formularz zostaje (plan §3.2).
   */
  const toLogin = useCallback(() => {
    if (leaveGuard.current().dirty) {
      setReauthOpen(true);
      return;
    }
    signOutLocally();
  }, [leaveGuard, signOutLocally]);
  useAuthExpiredHandler(toLogin);

  const login = useCallback(
    async (secret: string, setupFirst: boolean) => {
      if (setupFirst) {
        // pierwsze uruchomienie tworzy PIN i od razu nim loguje
        await callParent(() => parentClient.auth.setup({ secret }));
      }
      await callParent(() => parentClient.auth.login({ secret }));
      queryClient.setQueryData(AUTH_KEY, { authenticated: true, setupRequired: false });
    },
    [queryClient],
  );

  const logout = async () => {
    try {
      await callParent(() => parentClient.auth.logout());
    } catch {
      // brak sesji też kończy panel
    }
    signOutLocally();
  };

  if (auth.isPending) {
    return (
      <Center mih="100dvh">
        <Text c="dimmed">…</Text>
      </Center>
    );
  }

  if (!authenticated) {
    const setup = auth.data?.setupRequired === true;
    return (
      <Center mih="100dvh" p="md" className="pp-auth-screen">
        <Paper withBorder radius="lg" p="xl" w="100%" maw={420} shadow="sm">
          <Brand />
          <Title order={1} fz={26} mt="lg" mb={setup ? "xs" : "md"}>
            {setup ? messages.auth.setupTitle : messages.auth.loginTitle}
          </Title>
          {setup && <Text c="dimmed" mb="md">{messages.auth.setupHint}</Text>}
          <ParentAuthForm
            key={setup ? "setup" : "login"}
            idPrefix="auth"
            submitLabel={setup ? messages.auth.setupButton : messages.auth.loginButton}
            submit={(secret) => login(secret, setup)}
            initialError={auth.isError ? errorMessage(auth.error) : null}
            testIds={{ secret: "auth-secret", submit: "auth-submit", error: "api-error" }}
            extraAction={
              <Button component="a" href="/" variant="subtle" size="md" data-testid="to-learning">
                {messages.auth.toLearning}
              </Button>
            }
          />
        </Paper>
      </Center>
    );
  }

  // Pierwsze wczytanie list: bez danych sekcje pokazałyby mylący pusty stan
  // („Nie masz jeszcze…”). Nieudane odświeżenie przy istniejących danych
  // zostawia je na ekranie — błąd zgłasza wtedy sama sekcja.
  const listsWithoutData = [childrenQuery, decksQuery].filter((query) => query.data === undefined);
  const listsError = listsWithoutData.find((query) => query.isError)?.error;
  const listsPending = listsWithoutData.length > 0 && listsError === undefined;
  const childrenList = childrenQuery.data ?? [];
  const decks = decksQuery.data ?? [];

  return (
    <>
      <ParentShell
        section={section}
        onNavigate={navigate}
        onToLearning={() => leaveGuard.requestLeave(() => { window.location.href = "/"; })}
        onLogout={() => leaveGuard.requestLeave(logout)}
      >
        {listsError !== undefined ? (
          <Alert color="red" variant="light" role="alert" title={messages.parentShell.loadFailed} data-testid="panel-load-error">
            <Stack gap="sm" align="flex-start">
              <Text size="sm">{errorMessage(listsError)}</Text>
              <Button
                size="md"
                variant="light"
                color="red"
                data-testid="panel-load-retry"
                onClick={() => {
                  void queryClient.refetchQueries({ queryKey: CHILDREN_KEY, exact: true });
                  void queryClient.refetchQueries({ queryKey: DECKS_KEY, exact: true });
                }}
              >
                {messages.parentShell.retry}
              </Button>
            </Stack>
          </Alert>
        ) : listsPending ? (
          <Center py="xl" role="status" data-testid="panel-loading">
            <Group gap="sm">
              <Loader size="sm" />
              <Text>{messages.parentShell.loading}</Text>
            </Group>
          </Center>
        ) : section === "decks" ? (
          <DecksPanel
            decks={decks}
            childrenList={childrenList}
            onChanged={refreshDecks}
            registerEditorState={leaveGuard.register}
            requestLeave={leaveGuard.requestLeave}
            onAuthExpired={toLogin}
          />
        ) : section === "children" ? (
          <ChildEditor childrenList={childrenList} onChanged={refreshChildren} />
        ) : section === "progress" ? (
          <ProgressPanel childrenList={childrenList} decks={decks} onAuthExpired={toLogin} />
        ) : (
          <WorkCardPanel childrenList={childrenList} onAuthExpired={toLogin} />
        )}
      </ParentShell>
      <LeaveEditorDialog open={leaveGuard.pending} onStay={leaveGuard.stay} onLeave={() => void leaveGuard.leave()} />
      <Modal
        opened={reauthOpen}
        onClose={() => undefined}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        radius="lg"
        title={messages.auth.reauthTitle}
        attributes={{ content: { "data-testid": "reauth-dialog" } }}
      >
        <Text mb="md">{messages.auth.reauthHint}</Text>
        <ParentAuthForm
          idPrefix="reauth"
          submitLabel={messages.auth.loginButton}
          submit={async (secret) => {
            await login(secret, false);
            setReauthOpen(false);
          }}
          testIds={{ secret: "reauth-secret", submit: "reauth-submit", error: "reauth-error" }}
        />
      </Modal>
    </>
  );
}
