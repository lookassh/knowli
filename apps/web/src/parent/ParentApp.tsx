"use client";

import { useCallback, useEffect, useState } from "react";
import { messages, type ChildDto, type DeckSummaryDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import ChildEditor from "./ChildEditor";
import DecksPanel from "./DecksPanel";

type Phase = "loading" | "setup" | "login" | "panel";
type Tab = "decks" | "children";

interface AuthStateDto {
  authenticated: boolean;
  setupRequired: boolean;
}

/**
 * Panel rodzica Umiem!: pierwsze uruchomienie (PIN), logowanie, zestawy
 * i profile dzieci. Stan sesji pochodzi z API — przyciski nie są "zabezpieczeniem".
 */
export default function ParentApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState<Tab>("decks");
  const [error, setError] = useState<string | null>(null);
  const [childrenList, setChildrenList] = useState<ChildDto[]>([]);
  const [decks, setDecks] = useState<DeckSummaryDto[]>([]);

  const refreshChildren = useCallback(async () => {
    setChildrenList(await apiFetch<ChildDto[]>("GET", "/api/v1/parent/children"));
  }, []);
  const refreshDecks = useCallback(async () => {
    setDecks(await apiFetch<DeckSummaryDto[]>("GET", "/api/v1/parent/decks"));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const state = await apiFetch<AuthStateDto>("GET", "/api/v1/parent/login");
        if (state.authenticated) {
          setPhase("panel");
          await Promise.all([refreshChildren(), refreshDecks()]);
        } else {
          setPhase(state.setupRequired ? "setup" : "login");
        }
      } catch (cause) {
        setError(errorMessage(cause));
        setPhase("login");
      }
    })();
  }, [refreshChildren, refreshDecks]);

  const submitAuth = async () => {
    setError(null);
    try {
      if (phase === "setup") {
        // pierwsze uruchomienie tworzy PIN i od razu nim loguje
        await apiFetch("POST", "/api/v1/parent/setup", { secret });
      }
      await apiFetch("POST", "/api/v1/parent/login", { secret });
      setSecret("");
      setPhase("panel");
      await Promise.all([refreshChildren(), refreshDecks()]);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const logout = async () => {
    try {
      await apiFetch("POST", "/api/v1/parent/logout");
    } catch {
      // brak sesji też kończy panel
    }
    setPhase("login");
  };

  if (phase === "loading") {
    return (
      <main className="container">
        <p>…</p>
      </main>
    );
  }

  if (phase === "setup" || phase === "login") {
    return (
      <main className="container">
        <h1>{phase === "setup" ? messages.auth.setupTitle : messages.auth.loginTitle}</h1>
        {phase === "setup" && <p>{messages.auth.setupHint}</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitAuth();
          }}
        >
          <label>
            {messages.auth.pinLabel}
            <input
              data-testid="auth-secret"
              type="password"
              autoComplete="current-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              required
            />
          </label>
          <button type="submit" data-testid="auth-submit">
            {phase === "setup" ? messages.auth.setupButton : messages.auth.loginButton}
          </button>
        </form>
        {error && (
          <p className="error" data-testid="api-error" role="alert">
            {error}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="container">
      <header className="row space">
        <span className="brand">{messages.app.name}</span>
        <button type="button" onClick={logout}>
          {messages.auth.logoutButton}
        </button>
      </header>
      <nav className="tabs" aria-label="panel">
        <button
          type="button"
          data-testid="tab-decks"
          aria-current={tab === "decks"}
          onClick={() => setTab("decks")}
        >
          {messages.decks.title}
        </button>
        <button
          type="button"
          data-testid="tab-children"
          aria-current={tab === "children"}
          onClick={() => setTab("children")}
        >
          {messages.children.title}
        </button>
      </nav>
      {tab === "decks" ? (
        <DecksPanel decks={decks} childrenList={childrenList} onChanged={refreshDecks} />
      ) : (
        <ChildEditor childrenList={childrenList} onChanged={refreshChildren} />
      )}
    </main>
  );
}
