import { messages } from "@learning/contracts";
import type { KidApi } from "./api/KidApi";
import type { PlatformMedia } from "./media/platform";
import { DeckScreen } from "./screens/DeckScreen";
import { LearnScreen } from "./screens/LearnScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { SummaryScreen } from "./screens/SummaryScreen";
import { useLearningSession } from "./session/useLearningSession";
import type { LocalPreferences } from "./storage";

/**
 * Przenośny interfejs dziecka (plan zadania 9): KidApp({api, media, storage}).
 * Nie importuje Next.js ani kodu serwerowego — host web przekazuje klienta
 * HTTP z baseUrl, adaptery przeglądarkowe i pamięć lokalną; przyszły host
 * Capacitor podmieni wyłącznie te zależności.
 */
export function KidApp({ api, media, storage }: { api: KidApi; media: PlatformMedia; storage: LocalPreferences }) {
  const { controller, screen } = useLearningSession({ api, media, storage });

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
          <p className="kid-hint">{screen.message}</p>
        </main>
      );
    case "profile":
      return <ProfileScreen profiles={screen.profiles} onSelect={(childId) => void controller.selectProfile(childId)} />;
    case "deck":
      return (
        <DeckScreen
          decks={screen.decks}
          microphone={screen.microphone}
          micDenied={screen.micDenied}
          onToggleMicrophone={(on) => controller.setMicrophone(on)}
          onStart={(deckId) => void controller.startLearning(deckId)}
        />
      );
    case "learning":
      return <LearnScreen screen={screen} controller={controller} />;
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
