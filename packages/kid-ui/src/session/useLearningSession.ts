import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { KidApi } from "../api/KidApi";
import type { PlatformMedia } from "../media/platform";
import type { LocalPreferences } from "../storage";
import { LearningSessionController, type KidScreen } from "./session-controller";

/**
 * Spinacz Reacta nad sterownikiem przepływu. Cała logika pozostaje w
 * kontrolerze (przenośność, testowalność bez DOM); hook dodaje subskrypcję
 * snapshotu oraz reakcje przeglądarki: powrót z tła odświeża krok, zdarzenia
 * online/offline sterują trybem bez sieci.
 */
export function useLearningSession(deps: {
  api: KidApi;
  media: PlatformMedia;
  storage: LocalPreferences;
  pollIntervalMs?: number;
}): { controller: LearningSessionController; screen: KidScreen } {
  const controller = useMemo(
    () =>
      new LearningSessionController({
        api: deps.api,
        media: deps.media,
        storage: deps.storage,
        ...(deps.pollIntervalMs === undefined ? {} : { pollIntervalMs: deps.pollIntervalMs }),
      }),
    [deps.api, deps.media, deps.storage, deps.pollIntervalMs],
  );
  const screen = useSyncExternalStore(
    controller.subscribe,
    controller.getScreen,
    // SSR/preview: ekran startowy jest stabilny per instancja kontrolera
    controller.getScreen,
  );

  useEffect(() => {
    void controller.start();
    // opuszczenie widoku zatrzymuje mikrofon i odtwarzanie (RF5)
    return () => controller.teardown();
  }, [controller]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void controller.refreshStep();
      }
    };
    const onOffline = () => controller.markOffline();
    const onOnline = () => void controller.retry();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [controller]);

  return { controller, screen };
}
