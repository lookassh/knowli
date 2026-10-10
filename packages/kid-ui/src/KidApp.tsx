import type { ReactNode } from "react";
import { messages } from "@learning/contracts";
import type { KidApi } from "./api/KidApi";
import type { PlatformMedia } from "./media/platform";
import { DeckScreen } from "./screens/DeckScreen";
import { LearnScreen } from "./screens/LearnScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { MockTestReadyScreen, MockTestSummaryScreen, SessionConflictScreen } from "./screens/MockTestSummaryScreen";
import { useLearningSession } from "./session/useLearningSession";
import type { LocalPreferences } from "./storage";

export interface ParentLinkConfig {
  label: string;
  href: string;
}

/**
 * Przenośny interfejs dziecka (plan zadania 9): KidApp({api, media, storage}).
 * Nie importuje Next.js ani kodu serwerowego — host web przekazuje klienta
 * HTTP z baseUrl, adaptery przeglądarkowe i pamięć lokalną; przyszły host
 * Capacitor podmieni wyłącznie te zależności.
 */
export function KidApp({
  api,
  media,
  storage,
  initialChildId,
  parentLink,
  headerActions,
}: {
  api: KidApi;
  media: PlatformMedia;
  storage: LocalPreferences;
  initialChildId?: string;
  parentLink?: ParentLinkConfig;
  headerActions?: ReactNode;
}) {
  const { controller, screen } = useLearningSession({
    api,
    media,
    storage,
    ...(initialChildId === undefined ? {} : { initialChildId }),
  });

  const actions = headerActions ?? (parentLink ? (
    <a href={parentLink.href} className="kid-parent-link" data-testid="kid-parent-link">
      {parentLink.label}
    </a>
  ) : undefined);

  switch (screen.kind) {
    case "loading":
      return (
        <main className="kid-screen">
          <p className="kid-hint">{messages.kid.loading}</p>
        </main>
      );
    case "initError":
      return (
        <main className="kid-screen">
          {actions && <header className="kid-top-bar">{actions}</header>}
          <p className="kid-hint" data-testid="kid-init-error">{screen.message}</p>
          <button type="button" className="kid-primary" data-testid="kid-back-decks" onClick={() => void controller.backToDecks()}>{messages.kid.backToLearning}</button>
        </main>
      );
    case "profile":
      return (
        <ProfileScreen
          profiles={screen.profiles}
          onSelect={(childId) => void controller.selectProfile(childId)}
          headerActions={actions}
        />
      );
    case "deck":
      return (
        <DeckScreen
          decks={screen.decks}
          childName={screen.profiles.find((profile) => profile.childId === screen.childId)?.displayName ?? ""}
          microphone={screen.microphone}
          micDenied={screen.micDenied}
          onToggleMicrophone={(on) => controller.setMicrophone(on)}
          onStart={(deckId) => void controller.startLearning(deckId)}
          onMockTest={(deckId) => void controller.startMockTest(deckId)}
          headerActions={actions}
        />
      );
    case "learning":
      return <LearnScreen screen={screen} controller={controller} />;
    case "mockTestReady":
      return <MockTestReadyScreen session={screen.session} onStart={() => controller.beginMockTest()} onCancel={() => controller.cancelMockTest()} />;
    case "mockTestSummary":
      return <MockTestSummaryScreen summary={screen.summary} onPlay={taskId => controller.playMockTestSolution(taskId)} onPractice={() => controller.learnAgain()} onSwitchProfile={() => controller.switchProfile()} />;
    case "sessionConflict":
      return <SessionConflictScreen onResume={() => controller.resumeConflictingSession()} onClose={() => controller.closeConflictingSession()} />;
    case "summary":
      return (
        <SummaryScreen
          summary={screen.summary}
          profiles={screen.profiles}
          onAgain={() => void controller.learnAgain()}
          onSwitchProfile={() => void controller.switchProfile()}
        />
      );
  }
}
