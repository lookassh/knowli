import { useState, type ReactNode } from "react";
import { messages, type UiAudioKey } from "@learning/contracts";
import type { KidApi } from "./api/KidApi";
import type { PlatformMedia } from "./media/platform";
import { DeckScreen } from "./screens/DeckScreen";
import { LearnScreen } from "./screens/LearnScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { MockTestReadyScreen, MockTestSummaryScreen, SessionConflictScreen } from "./screens/MockTestSummaryScreen";
import { LessonMockTestSummaryScreen } from "./screens/LessonMockTestSummaryScreen";
import { useLearningSession } from "./session/useLearningSession";
import type { LocalPreferences } from "./storage";
import { KidPage } from "./layout/KidPage";
import { GuidanceButton } from "./components/GuidanceButton";

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
  const [requestingXboxChildId, setRequestingXboxChildId] = useState<string | null>(null);
  const [requestErrorChildId, setRequestErrorChildId] = useState<string | null>(null);
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

  async function requestXboxPack(childId: string): Promise<void> {
    setRequestingXboxChildId(childId);
    setRequestErrorChildId(null);
    try {
      await controller.requestXboxPack(childId);
    } catch {
      setRequestErrorChildId(childId);
    } finally {
      setRequestingXboxChildId(null);
    }
  }

  switch (screen.kind) {
    case "loading":
      return (
        <KidPage mode="flow"><main className="kid-screen">
          <p className="kid-hint">{messages.kid.loading}</p>
        </main></KidPage>
      );
    case "initError":
      return (
        <KidPage mode="flow"><main className="kid-screen">
          {actions && <header className="kid-top-bar">{actions}</header>}
          <p className="kid-hint" data-testid="kid-init-error">{screen.message}</p>
          <button type="button" className="kid-primary" data-testid="kid-back-decks" onClick={() => void controller.backToDecks()}>{messages.kid.backToLearning}</button>
        </main></KidPage>
      );
    case "profile":
      return (
        <KidPage mode="flow">
        <ProfileScreen
          profiles={screen.profiles}
          onSelect={(childId) => void controller.selectProfile(childId)}
          headerActions={actions}
          onGuidance={(key: UiAudioKey) => controller.playGuidance(key)}
          onRequestXbox={(childId) => void requestXboxPack(childId)}
          requestingChildId={requestingXboxChildId}
          requestErrorChildId={requestErrorChildId}
        />
        </KidPage>
      );
    case "deck":
      return (
        <KidPage mode="flow">
        <DeckScreen
          decks={screen.decks}
          childName={screen.profiles.find((profile) => profile.childId === screen.childId)?.displayName ?? ""}
          todayActivitySeconds={screen.profiles.find((profile) => profile.childId === screen.childId)?.todayActivitySeconds}
          todayActivityUnavailable={screen.profiles.find((profile) => profile.childId === screen.childId)?.todayActivityUnavailable}
          mediaUrl={(assetId) => controller.mediaUrl(assetId)}
          microphone={screen.microphone}
          micDenied={screen.micDenied}
          onToggleMicrophone={(on) => controller.setMicrophone(on)}
          onStart={(deckId) => void controller.startLearning(deckId)}
          onMockTest={(deckId) => void controller.startMockTest(deckId)}
          onEndActive={(deckId) => void controller.endActiveSession(deckId)}
          headerActions={actions}
          onGuidance={(key: UiAudioKey) => controller.playGuidance(key)}
        />
        </KidPage>
      );
    case "learning":
      return <KidPage mode="session"><LearnScreen screen={screen} controller={controller} /></KidPage>;
    case "mockTestReady":
      return <KidPage mode="flow"><MockTestReadyScreen session={screen.session} onStart={() => controller.beginMockTest()} onCancel={() => controller.cancelMockTest()} /></KidPage>;
    case "mockTestSummary":
      return <KidPage mode="flow"><MockTestSummaryScreen summary={screen.summary} onPlay={taskId => controller.playMockTestSolution(taskId)} onPractice={() => controller.learnAgain()} onSwitchProfile={() => controller.switchProfile()} /></KidPage>;
    case "lessonMockTestSummary":
      return <KidPage mode="flow"><LessonMockTestSummaryScreen summary={screen.summary} onPractice={() => controller.learnAgain()} onSwitchProfile={() => controller.switchProfile()} /></KidPage>;
    case "sessionConflict":
      return <KidPage mode="flow"><SessionConflictScreen onResume={() => controller.resumeConflictingSession()} onClose={() => controller.closeConflictingSession()} /></KidPage>;
    case "summary":
      return (
        <KidPage mode="flow">
        <SummaryScreen
          summary={screen.summary}
          profiles={screen.profiles}
          onAgain={() => void controller.learnAgain()}
          onSwitchProfile={() => void controller.switchProfile()}
          guidance={<GuidanceButton audioKey="summary" onPlay={(key) => controller.playGuidance(key)} testId="kid-summary-guidance" />}
        />
        </KidPage>
      );
  }
}
