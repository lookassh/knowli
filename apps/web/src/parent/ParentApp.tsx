"use client";

import { useCallback, useEffect, useState } from "react";
import { messages, type ChildDto, type DeckSummaryDto } from "@learning/contracts";
import { apiFetch, errorMessage } from "./api";
import ChildEditor from "./ChildEditor";
import DecksPanel from "./DecksPanel";
import LeaveEditorDialog from "./LeaveEditorDialog";
import ProgressPanel from "./ProgressPanel";
import { useParentLeaveGuard } from "./useParentLeaveGuard";
import { ParentIcon } from "./ParentIcon";
import "./parent.css";

type Phase = "loading" | "setup" | "login" | "panel";
type Tab = "decks" | "children" | "progress";

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
  const leaveGuard = useParentLeaveGuard();

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
      <div className="pp-app">
        <main className="pp-main">
          <p>…</p>
        </main>
      </div>
    );
  }

  if (phase === "setup" || phase === "login") {
    return (
      <div className="pp-auth">
        <section className="pp-auth-card">
          <div className="pp-auth-brand">
            <span className="pp-logo" aria-hidden="true">U!</span>
            <div>
              <div className="pp-brand-name">{messages.app.name}</div>
              <div className="pp-brand-sub">{messages.app.parentPanel}</div>
            </div>
          </div>
          <h1>{phase === "setup" ? messages.auth.setupTitle : messages.auth.loginTitle}</h1>
          {phase === "setup" && <p className="pp-auth-hint">{messages.auth.setupHint}</p>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitAuth();
            }}
          >
            <label htmlFor="auth-secret-input">
              {messages.auth.pinLabel}
              <input
                id="auth-secret-input"
                data-testid="auth-secret"
                type="password"
                autoComplete="current-password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                required
              />
            </label>
            <div className="pp-auth-actions">
              <button type="submit" className="pp-btn pp-btn-primary" data-testid="auth-submit">
                {phase === "setup" ? messages.auth.setupButton : messages.auth.loginButton}
              </button>
              <a href="/" className="pp-btn pp-btn-ghost" data-testid="to-learning">
                {messages.auth.toLearning}
              </a>
            </div>
          </form>
          {error && (
            <p className="pp-error" data-testid="api-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="pp-app">
      <header className="pp-topbar">
        <div className="pp-topbar-in">
          <div className="pp-brand">
            <span className="pp-logo" aria-hidden="true">U!</span>
            <div>
              <div className="pp-brand-name">{messages.app.name}</div>
              <div className="pp-brand-sub">{messages.app.parentPanel}</div>
            </div>
          </div>
          <div className="pp-topbar-actions">
            <a
              href="/"
              className="pp-btn pp-btn-ghost"
              data-testid="to-learning"
              onClick={(event) => {
                event.preventDefault();
                leaveGuard.requestLeave(() => {
                  window.location.href = "/";
                });
              }}
            >
              <ParentIcon name="play" />
              {messages.auth.toLearning}
            </a>
            <button
              type="button"
              className="pp-btn pp-btn-ghost"
              data-testid="parent-logout"
              onClick={() => leaveGuard.requestLeave(logout)}
            >
              <ParentIcon name="log-out" />
              {messages.auth.logoutButton}
            </button>
          </div>
        </div>
        <nav className="pp-tabs" aria-label="panel">
          <button
            type="button"
            className="pp-tab"
            data-testid="tab-decks"
            aria-current={tab === "decks"}
            onClick={() => tab !== "decks" && leaveGuard.requestLeave(() => setTab("decks"))}
          >
            <ParentIcon name="layers" />
            {messages.decks.title}
          </button>
          <button
            type="button"
            className="pp-tab"
            data-testid="tab-children"
            aria-current={tab === "children"}
            onClick={() => tab !== "children" && leaveGuard.requestLeave(() => setTab("children"))}
          >
            <ParentIcon name="users" />
            {messages.children.title}
          </button>
          <button
            type="button"
            className="pp-tab"
            data-testid="tab-progress"
            aria-current={tab === "progress"}
            onClick={() => tab !== "progress" && leaveGuard.requestLeave(() => setTab("progress"))}
          >
            <ParentIcon name="trending-up" />
            {messages.progress.title}
          </button>
        </nav>
      </header>
      <main className="pp-main">
        {tab === "decks" ? (
          <DecksPanel
            decks={decks}
            childrenList={childrenList}
            onChanged={refreshDecks}
            registerEditorState={leaveGuard.register}
            requestLeave={leaveGuard.requestLeave}
            onAuthExpired={() => setPhase("login")}
          />
        ) : tab === "children" ? (
          <ChildEditor childrenList={childrenList} onChanged={refreshChildren} />
        ) : (
          <ProgressPanel childrenList={childrenList} decks={decks} />
        )}
      </main>
      <LeaveEditorDialog open={leaveGuard.pending} onStay={leaveGuard.stay} onLeave={() => void leaveGuard.leave()} />
    </div>
  );
}
