import type { UiAudioCatalogDto, UiAudioKey } from "@learning/contracts";
import type { AudioPlayer } from "../media/platform";

/** Serializuje krótkie, stałe instrukcje interfejsu; stop unieważnia też kolejkę. */
export function createGuidanceAudio(
  catalog: UiAudioCatalogDto,
  player: AudioPlayer,
  mediaUrl: (assetId: string) => string,
): { play(key: UiAudioKey): Promise<void>; stop(): void } {
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  return {
    play(key) {
      const ticket = generation;
      const assetId = catalog.ready ? catalog.assets[key] : undefined;
      if (!assetId) return Promise.reject(new Error("UI audio unavailable"));
      const playback = queue.then(async () => {
        if (ticket !== generation) return;
        await player.play(mediaUrl(assetId));
      });
      queue = playback.catch(() => undefined);
      return playback;
    },
    stop() {
      generation += 1;
      queue = Promise.resolve();
      player.stop();
    },
  };
}
